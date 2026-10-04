import jwt
from fastapi import HTTPException, Request

from . import config

# Clerk's public signing keys, fetched on first use and cached.
_jwks = jwt.PyJWKClient(config.CLERK_JWKS_URL)


def current_user(request: Request) -> str:
    """Verify the Clerk session token on the request and return the Clerk user ID."""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer":
        # <audio src> and download links cannot send headers, so reads may fall back to the
        # session cookie Clerk sets on the app's origin. Writes always need the header (CSRF).
        token = request.cookies.get("__session") if request.method == "GET" else None
    if not token:
        raise HTTPException(401, "Not signed in")
    try:
        key = _jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"], issuer=config.CLERK_ISSUER,
                            leeway=5, options={"require": ["exp", "iat", "sub"]})
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(503, "Cannot reach the sign-in service. Try again shortly.")
    except jwt.PyJWTError:
        raise HTTPException(401, "Not signed in")
    # azp is the origin the token was issued to; reject tokens minted for another site.
    if claims.get("azp") not in (None, *config.FRONTEND_ORIGINS):
        raise HTTPException(401, "Not signed in")
    return claims["sub"]
