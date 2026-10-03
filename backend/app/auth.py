import base64
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from . import config, db

router = APIRouter(prefix="/auth", tags=["auth"])

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
_PHONE = re.compile(r"^\+[1-9]\d{6,14}$")  # E.164
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"{salt.hex()}${hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT).hex()}"


def verify_password(password: str, stored: str) -> bool:
    if "$" not in stored:  # Google-only account: no password set
        return False
    salt, digest = stored.split("$")
    got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **_SCRYPT).hex()
    return hmac.compare_digest(got, digest)


_DUMMY_HASH = hash_password(secrets.token_hex(8))  # keeps login timing equal for unknown emails


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _public(user) -> dict:
    return {"id": user["id"], "name": user["name"], "email": user["email"], "phone": user["phone"]}


def _start_session(response: Response, user_id: str):
    # The raw token only ever lives in the HttpOnly cookie; the DB keeps its hash.
    token = secrets.token_urlsafe(32)
    with db.conn() as c:
        c.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        c.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)",
                  (_token_hash(token), user_id, time.time() + config.SESSION_TTL_SECONDS))
    response.set_cookie(config.SESSION_COOKIE, token, max_age=config.SESSION_TTL_SECONDS,
                        httponly=True, samesite="lax", secure=config.COOKIE_SECURE, path="/")


def _create_user(c, name: str, email: str, phone: str, password_hash: str) -> str:
    user_id = uuid.uuid4().hex
    first = c.execute("SELECT 1 FROM users LIMIT 1").fetchone() is None
    c.execute("INSERT INTO users (id, name, email, phone, password_hash) VALUES (?,?,?,?,?)",
              (user_id, name, email, phone, password_hash))
    if first:  # adopt voices saved before accounts existed
        c.execute("UPDATE voices SET user_id=? WHERE user_id='local'", (user_id,))
    return user_id


def current_user(session: str | None = Cookie(None, alias=config.SESSION_COOKIE)):
    if session:
        with db.conn() as c:
            user = c.execute(
                "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires_at > ?",
                (_token_hash(session), time.time()),
            ).fetchone()
        if user is not None:
            return user
    raise HTTPException(401, "Not signed in")


class SignupRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=254)
    phone: str
    password: str = Field(min_length=12, max_length=20)

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Enter your full name")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        v = v.strip().lower()
        if not _EMAIL.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        v = re.sub(r"[\s\-()]", "", v)
        if not _PHONE.match(v):
            raise ValueError("Enter a valid phone number with country code")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v):
        if not (re.search(r"[A-Z]", v) and re.search(r"[a-z]", v) and re.search(r"\d", v) and re.search(r"[^A-Za-z0-9]", v)):
            raise ValueError("Password needs an uppercase letter, a lowercase letter, a number and a symbol")
        return v


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)


@router.post("/signup", status_code=201)
def signup(body: SignupRequest, response: Response):
    password_hash = hash_password(body.password)
    try:
        with db.conn() as c:
            user_id = _create_user(c, body.name, body.email, body.phone, password_hash)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "An account with this email already exists")
    _start_session(response, user_id)
    return {"id": user_id, "name": body.name, "email": body.email, "phone": body.phone}


@router.post("/login")
def login(body: LoginRequest, response: Response):
    with db.conn() as c:
        user = c.execute("SELECT * FROM users WHERE email=?", (body.email.strip().lower(),)).fetchone()
    ok = verify_password(body.password, user["password_hash"] if user else _DUMMY_HASH)
    if user is None or not ok:
        raise HTTPException(401, "Incorrect email or password")
    _start_session(response, user["id"])
    return _public(user)


class GoogleRequest(BaseModel):
    code: str = Field(min_length=1, max_length=2048)


def _google_identity(code: str) -> dict:
    """Exchange the popup's one-time auth code for the claims of Google's ID token."""
    form = urllib.parse.urlencode({
        "code": code, "client_id": config.GOOGLE_CLIENT_ID, "client_secret": config.GOOGLE_CLIENT_SECRET,
        "redirect_uri": "postmessage", "grant_type": "authorization_code",
    }).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(_GOOGLE_TOKEN_URL, data=form), timeout=10) as r:
            payload = json.load(r)["id_token"].split(".")[1]
        # The token came straight from Google over TLS, so its signature needs no separate check.
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError):
        raise HTTPException(401, "Google sign-in failed. Please try again.")


@router.get("/config")
def auth_config():
    enabled = bool(config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET)
    return {"google_client_id": config.GOOGLE_CLIENT_ID if enabled else None}


@router.post("/google")
def google(body: GoogleRequest, response: Response, x_requested_with: str | None = Header(None)):
    """Sign in, or create the account on first use, from a Google auth code."""
    if not (config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET):
        raise HTTPException(503, "Google sign-in is not configured")
    if x_requested_with != "XMLHttpRequest":  # custom header a cross-site form cannot send
        raise HTTPException(400, "Bad request")
    claims = _google_identity(body.code)
    email = str(claims.get("email", "")).strip().lower()
    if claims.get("aud") != config.GOOGLE_CLIENT_ID or not email or claims.get("email_verified") not in (True, "true"):
        raise HTTPException(401, "Google sign-in failed. Please try again.")
    with db.conn() as c:
        user = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if user is None:
            name = str(claims.get("name") or email.split("@")[0])[:80]
            _create_user(c, name, email, "", "")
            user = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    _start_session(response, user["id"])
    return _public(user)


@router.get("/me")
def me(user=Depends(current_user)):
    return _public(user)


@router.post("/logout", status_code=204)
def logout(response: Response, session: str | None = Cookie(None, alias=config.SESSION_COOKIE)):
    if session:
        with db.conn() as c:
            c.execute("DELETE FROM sessions WHERE token_hash=?", (_token_hash(session),))
    response.delete_cookie(config.SESSION_COOKIE, path="/")
