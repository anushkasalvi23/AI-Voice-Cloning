import { useState } from "react";
import "../landing.css";

const APP = "#/app";

export const Logo = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M14 1.5 5 6v8.5l9-4.5v-8.5ZM10 14l9-4.5V18l-9 4.5V14Z" />
  </svg>
);

const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="m2 3.5 3 3 3-3" /></svg>
);
const Play = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9l7.5-4.5z" /></svg>
);
const Check = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1"><circle cx="7" cy="7" r="6" /><path d="m4.5 7 1.8 1.8L9.5 5.5" /></svg>
);

const Wave = ({ n = 18, active }) => (
  <span className={`wave${active ? " wave-active" : ""}`} aria-hidden="true">
    {Array.from({ length: n }, (_, i) => (
      <i key={i} style={{ height: `${25 + Math.abs(Math.sin(i * 1.7 + 1) * 70)}%` }} />
    ))}
  </span>
);

const trusted = [
  ["Spotify", "●"], ["airbnb", "⌂"], ["monday.com", "//"], ["Google", ""], ["Microsoft", "▦"],
];

const pillars = [
  { t: "Unified Voice System", d: "Voice creation often lives in silos scripts in one place, voices in another, outputs somewhere else.", icon: "grid" },
  { t: "Consistency at Scale", d: "Eva maintains voice consistency ensuring every output sounds intentional and on brand even at global scale.", icon: "ring" },
  { t: "Future-Proof Voice Infrastructure", d: "Eva is built as a long-term voice infrastructure, ready to new experiences without rebuilding from scratch.", icon: "dots" },
];

const features = [
  { t: "Emotion & Tone Control", d: "Fine-tune how your voice sounds. Adjust mood, intensity, and delivery style to match the exact feeling you want to convey." },
  { t: "Accent & Language Adaptation" },
  { t: "Script-to-Voice Studio" },
];

const plans = [
  { name: "Starter", price: "$0", blurb: "Perfect for trying out the engine.", items: ["10 mins of generation per month", "Standard voice library", "Personal use license", "Standard support"] },
  { name: "Creator", price: "$29", unit: "/mo", blurb: "For narrators and content creators.", dark: true, items: ["Everything in Starter", "10 hours of generation per month", "Instant Voice Cloning (3 voices)", "Commercial usage rights", "High quality download (WAV)", "API Access (Rate limited)"] },
  { name: "Enterprise", price: "Custom", blurb: "Scale your production pipeline.", items: ["Unlimited generation", "Professional Voice Cloning", "SSO & Team Management", "Custom SLA & Priority Support", "Dedicated Account Manager"] },
];

const faqs = [
  ["Can i use the generated audio for commercial purpose?", "Yes. If you are on the Creator plan or higher, you own full commercial rights to the audio you generate. You can use it in monetized YouTube videos, commercials, audiobooks, and more."],
  ["What happen if I run out of generation minutes?", "Generation pauses until your next billing cycle, or you can upgrade your plan at any time to keep creating."],
  ["How does Voice Cloning work?", "Upload a 30-second clip of clear audio and Eva builds a reusable voice you can use to speak any text."],
  ["Is there an API available?", "Yes. Creator plans include rate-limited API access, and Enterprise plans include higher limits."],
  ["Do you support multiple languages?", "Yes. Eva speaks many languages and can adapt accents while keeping the original voice identity."],
];

const posts = [
  { tag: "Product Update", date: "Feb 12, 2026", t: "Introducing Turbo v2.5: 3x Faster Generation & Lower Latency", d: "Our newest model pushes the boundaries of real-time conversational AI with sub-50ms latency.", bg: "#f0efef", art: "cone" },
  { tag: "Tutorial", date: "Feb 08, 2026", t: "The Complete Guide to AI Voice for Indie Game Developers", d: "Learn how to integrate dynamic NPC dialogue into Unity and Unreal Engine projects using our SDK.", bg: "#f6f3e6", art: "hex" },
  { tag: "Community", date: "Jan 28, 2026", t: "Ethical AI: How We Protect Voice Identity", d: "A deep dive into our safety protocols, voice watermarking, and consent verification systems.", bg: "#eeeef3", art: "spiral" },
];

const footer = {
  Product: ["Technology", "Integrations", "Releases", "Status"],
  Resources: ["Docs", "API Reference", "Tutorial", "System Guide"],
  Company: ["Team", "Culture", "Jobs", "Press Kit"],
  Legal: ["Imprint", "Data Policy", "Cookie Policy", "Accessibility", "Terms of Use"],
};

function PillarIcon({ kind }) {
  const dots = [];
  if (kind === "ring") {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      dots.push(<ellipse key={i} cx={16 + Math.cos(a) * 12} cy={16 + Math.sin(a) * 8.5} rx="2.1" ry={2.1 + Math.abs(Math.cos(a)) * 1.6} />);
    }
  } else if (kind === "dots") {
    for (let i = 1; i < 46; i++) {
      const a = i * 2.39996, r = 2.1 * Math.sqrt(i);
      dots.push(<circle key={i} cx={16 + Math.cos(a) * r} cy={16 + Math.sin(a) * r} r={0.5 + (i / 46) * 0.9} />);
    }
  } else {
    for (let x = -3; x <= 3; x++)
      for (let y = -3; y <= 3; y++) {
        const d = Math.hypot(x, y);
        if (d < 3.7) dots.push(<circle key={`${x},${y}`} cx={16 + x * 4.3} cy={16 + y * 4.3} r={1.9 - d * 0.22} />);
      }
  }
  return <svg width="44" height="44" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">{dots}</svg>;
}

function Art({ kind }) {
  if (kind === "cone")
    return (
      <svg viewBox="0 0 240 140" fill="none" stroke="#1d1d33" strokeWidth=".8">
        {Array.from({ length: 14 }, (_, i) => (
          <ellipse key={i} cx={20 + i * 11} cy="70" rx={3 + i * 0.9} ry={4 + i * 4.6} />
        ))}
        <ellipse cx="177" cy="70" rx="48" ry="63" strokeDasharray="1 3" />
      </svg>
    );
  if (kind === "hex")
    return (
      <svg viewBox="0 0 240 140" fill="none" stroke="#1d1d33" strokeWidth="1">
        <path d="M120 18 172 48v60l-52 30-52-30V48z" />
        <path d="M120 78 68 48M120 78l52-30M120 78v60M120 18v60" />
        <path d="M94 33l52 30M146 33 94 63M94 93l52 30" stroke="#c9a85a" strokeDasharray="2 2" />
      </svg>
    );
  return (
    <svg viewBox="0 0 240 140" fill="none" stroke="#2b2b3d" strokeWidth=".5">
      {Array.from({ length: 22 }, (_, i) => (
        <ellipse key={i} cx="120" cy="70" rx={4 + i * 2.5} ry={4 + i * 2.5} transform={`rotate(${i * 9} 120 70) translate(${i * 0.5} 0)`} />
      ))}
    </svg>
  );
}

export default function Landing() {
  const [tab, setTab] = useState("Text to Speech");
  const [feature, setFeature] = useState(0);
  const [billing, setBilling] = useState("Monthly");
  const [lang, setLang] = useState("Typescript");
  const [faq, setFaq] = useState(0);

  return (
    <div className="eva">
      {/* HERO */}
      <header className="hero">
        <nav className="nav wrap">
          <a className="brand" href="#/"><Logo /> <span>EVA</span></a>
          <ul className="nav-links">
            {["Research", "Product", "For Developers", "Resources"].map((l) => <li key={l}><a href="#/">{l}</a></li>)}
          </ul>
          <div className="nav-actions">
            <a className="btn btn-light" href="#/login">Log In</a>
            <a className="btn btn-dark" href="#/signup">Sign Up</a>
          </div>
        </nav>

        <div className="hero-body wrap">
          <h1>Human Voice,<br />Engineered by AI</h1>
          <p className="lead">AI voice models power millions of developers and enterprises. From conversational agents to top voice generators for audiobooks.</p>
          <div className="cta-row">
            <a className="btn btn-dark" href={APP}>Start Creating</a>
            <a className="btn btn-light" href="#/">Contact Sales</a>
          </div>

          <div className="demo">
            <div className="demo-top">
              <span className="brand small"><Logo size={16} /> <span>EVA</span></span>
              <div className="demo-tabs">
                {["Text to Speech", "SFX", "Music", "Voice Cloning", "Studio"].map((t) => (
                  <button key={t} className={`pill${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
                    {t}{t === "Studio" && <em className="badge">BETA</em>}
                  </button>
                ))}
              </div>
            </div>
            <div className="demo-text">
              Beyond the silver dunes of Avaris, where the moon painted the sands in liquid light, stood a forgotten tower of glass and stone. <b>[softly]</b> No one remembered who built it… <b>[pause]</b> or why it still hummed at night. Inside lived a keeper named Solren. <b>[amused]</b> Not a wizard exactly… though he did have a habit of talking to the walls. <b>[whispers]</b> And sometimes… the walls answered.”
            </div>
            <div className="demo-bar">
              <span className="chip"><i className="orb" /> Zenith Axel <Chevron /></span>
              <span className="chip"><i className="flag" /> English <Chevron /></span>
              <span className="chip"><i className="orb orb2" /> Casual &amp; Conversational <Chevron /></span>
              <button className="play" aria-label="Play"><Play /></button>
            </div>
          </div>

          <div className="trusted">
            <span>Trusted by:</span>
            {trusted.map(([n, g]) => <b key={n}><i>{g}</i>{n}</b>)}
          </div>
        </div>
      </header>

      {/* WHY */}
      <section className="why wrap">
        <p className="eyebrow center">WHY EVA?</p>
        <h2 className="statement">
          Eva tackles the challenges of AI voice fragmentation, inefficiency, and trust concerns by <span>developing a robust and scalable system that users can rely on.</span>
        </h2>
        <div className="pillars">
          {pillars.map((p) => (
            <article key={p.t} className="pillar">
              <PillarIcon kind={p.icon} />
              <div>
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* CLONING */}
      <section className="cloning wrap">
        <div className="clone-copy">
          <p className="eyebrow">SAY GOODBYE TO ANNOYING VOICE-OVERS</p>
          <h2>Instant Voice Cloning</h2>
          <p className="muted">Just upload a 30-second audio clip to clone any voice. Get those unique tones, accents, and feelings like never before!</p>
          <a className="btn btn-dark" href={APP}>Start Creating</a>
          <ul className="acc">
            {features.map((f, i) => (
              <li key={f.t} className={feature === i ? "open" : ""}>
                <button onClick={() => setFeature(i)} aria-expanded={feature === i}>
                  <span className="acc-ico">{["✦", "文", "◘"][i]}</span>
                  <span>{f.t}</span>
                  <span className="plus">{feature === i ? "−" : "+"}</span>
                </button>
                {feature === i && f.d && <p>{f.d}</p>}
              </li>
            ))}
          </ul>
        </div>

        <div className="clone-ui">
          <div className="window">
            <div className="window-bar">
              <span className="dots"><i /><i /><i /></span>
              <span className="url">voice-sample-upload</span>
              <span className="up">Upload</span>
            </div>
            <div className="drop">
              <span>Drop a 30-second audio clip or <b>browse</b></span>
              <small>MP3, WAV, M4A · max 10MB</small>
            </div>
            <p className="tiny">Voice engine ready · Upload 30s of clear audio for best results</p>
          </div>
          <div className="voices-head"><span className="tiny">CLONED VOICES</span><span className="newclone">+ New Clone</span></div>
          {[["AM", "Aria Mitchell", true], ["JR", "James Rivera"], ["SC", "Sofia Chen"]].map(([ini, name, on]) => (
            <div key={name} className={`voice${on ? " on" : ""}`}>
              <span className={`avatar${on ? " av-on" : ""}`}>{ini}</span>
              <div className="voice-info">
                <b>{name}</b>
                <Wave n={14} active={on} />
              </div>
              <span className={`status${on ? " st-on" : ""}`}>{on ? "Active" : "Idle"}</span>
              <button className={`play${on ? "" : " ghost"}`} aria-label="Play">{on ? "❚❚" : <Play size={10} />}</button>
            </div>
          ))}
          <div className="voices-foot"><span>● Clone engine ready · 30s sample recommended for best results</span><span className="settings">⚙ Settings</span></div>
        </div>
      </section>

      {/* OFFER */}
      <section className="offer wrap">
        <p className="eyebrow">WHAT WE OFFER</p>
        <div className="offer-head">
          <h2>Built for every story,<br />across every industry.</h2>
          <p className="muted">Whether you're an indie developer or a global enterprise, scalable voice generation fits right into your workflow.</p>
        </div>
        <div className="cards3">
          <article className="ucard">
            <div className="ucard-art a1">
              <span className="bubble b1">Hey! Welcome back to my channel 🖋</span>
              <span className="bubble b2"><i className="mic" /> Add a voiceover now ✨</span>
              <span className="bubble b3"><Wave n={10} active /> <small>0/12</small></span>
              <span className="bubble b4">Record your narration 🎙</span>
              <span className="bubble b5">♪ Voice cloned successfully!</span>
            </div>
            <h3>Content Creation</h3>
            <p>Dub YouTube videos, create viral content, or narrate docs easily.</p>
          </article>
          <article className="ucard">
            <div className="ucard-art a2">
              <div className="photo" />
              <div className="report">
                <b>AI Report <em>scheduled</em></b>
                <ul>
                  <li>Client describes SpeedAI as a tool that is running on a cloud solution but at a significantly higher price. <u>07:57</u></li>
                  <li>Client discusses competitor's limitations the lack of features for sharing recordings across teams. <u>07:58</u></li>
                </ul>
                <small>Send every: <em>Friday</em> <em>10 am</em></small>
              </div>
            </div>
            <h3>E-Learning</h3>
            <p>Instantly update course material. Convert textbooks to audiobooks for accessibility.</p>
          </article>
          <article className="ucard">
            <div className="ucard-art a3">
              <div className="tiles">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div>
              <div className="npc">
                <b><Wave n={6} active /> NPC VOICE</b>
                <code>eva.npc.dialogue()<br />&nbsp;character: 'Guard',<br />&nbsp;script: npcText,<br />&nbsp;emotion: 'urgent',</code>
                <small>● Voice stream active</small>
              </div>
              <div className="npc-label"><Wave n={8} active /> Eva NPC</div>
            </div>
            <h3>Gaming &amp; VR</h3>
            <p>Develop dynamic NPC dialogue and mods with unique voice acting or scripts.</p>
          </article>
        </div>
      </section>

      {/* PRICING */}
      <section className="pricing wrap">
        <p className="eyebrow center">PRICING</p>
        <h2 className="center">Simple, transparent pricing</h2>
        <p className="muted center">Start free, upgrade as you grow. No hidden fees.</p>
        <div className="toggle">
          {["Monthly", "Annual"].map((b) => (
            <button key={b} className={billing === b ? "on" : ""} onClick={() => setBilling(b)}>
              {b}{b === "Annual" && <em className="badge">-20% Off</em>}
            </button>
          ))}
        </div>
        <div className="plans">
          {plans.map((p) => {
            const price = p.unit && billing === "Annual" ? `$${Math.round(parseInt(p.price.slice(1), 10) * 0.8)}` : p.price;
            return (
              <article key={p.name} className="plan">
                <h3>{p.name}</h3>
                <div className="price">{price}{p.unit && <small>{p.unit}</small>}</div>
                <p className="muted">{p.blurb}</p>
                <hr />
                <ul>{p.items.map((i) => <li key={i}><Check /> {i}</li>)}</ul>
                <a className={`btn btn-block ${p.dark ? "btn-dark" : "btn-outline"}`} href={APP}>Start for Free</a>
              </article>
            );
          })}
        </div>
      </section>

      {/* DEVELOPERS */}
      <section className="dev wrap">
        <div className="dev-head">
          <div>
            <p className="eyebrow">DEVELOPER FIRST</p>
            <h2>Integrate human-like<br />voice with 3 lines of code.</h2>
          </div>
          <div className="dev-side">
            <p className="muted">Our API is designed for performance. Stream audio with &lt;50ms latency, manage websocket connections effortlessly, and scale to millions of requests.</p>
            <a className="btn btn-dark" href="#/">Read Documentation</a>
          </div>
        </div>
        <div className="dev-stage">
          <div className="lang-tabs">
            {["Typescript", "Python", ".NET", "Swift"].map((l) => (
              <button key={l} className={lang === l ? "on" : ""} onClick={() => setLang(l)}>{l}</button>
            ))}
          </div>
          <div className="code">
            <div className="code-bar"><span className="dots"><i /><i /><i /></span><span className="fname">index.ts</span><span className="copy">⧉ Copy</span></div>
            <pre>
<span className="k">import</span> {"{ "}<span className="f">HumeClient</span>{" }"} <span className="k">from</span> <span className="s">'Voxia'</span>{"\n\n"}
<span className="k">const</span> client = <span className="k">new</span> <span className="f">HumeClient</span>({"{ "}apiKey: <span className="s">'YOUR_API_KEY'</span>{" })"}{"\n\n"}
<span className="k">await</span> client.tts.<span className="f">synthesizeFileStreaming</span>({"{\n  "}utterances: [{"\n    {\n      "}text: <span className="s">'Dogs became domesticated between 23,000 and 30,000 years ago.'</span>,{"\n      "}voice: {"{ "}name: <span className="s">'Male English Actor'</span>, provider: <span className="s">'Voxia_AI'</span> {"},\n    },\n  ],\n})"}
            </pre>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq wrap">
        <h2 className="center">Frequently asked questions</h2>
        <p className="muted center">Everything you need to know about the product and billing.</p>
        <div className="faq-list">
          {faqs.map(([q, a], i) => (
            <div key={q} className={`faq-item${faq === i ? " open" : ""}`}>
              <button onClick={() => setFaq(faq === i ? -1 : i)} aria-expanded={faq === i}>
                <span>{q}</span><span className="plus">{faq === i ? "−" : "+"}</span>
              </button>
              {faq === i && <p>{a}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="final">
        <div className="final-card wrap-narrow">
          <span className="logo-tile"><Logo size={18} /></span>
          <h2>Ready to give your<br />content a voice?</h2>
          <p className="muted">Start creating lifelike speech in seconds. No credit card required for the starter plan.</p>
          <div className="cta-row">
            <a className="btn btn-dark" href={APP}>Start Creating</a>
            <a className="btn btn-light" href="#/">Contact Sales</a>
          </div>
        </div>
      </section>

      {/* BLOG */}
      <section className="blog wrap">
        <div className="blog-head">
          <div>
            <h2>Latest from Eva</h2>
            <p className="muted">Product updates, tutorials, and industry insights.</p>
          </div>
          <a className="btn btn-light" href="#/">View all articles →</a>
        </div>
        <div className="cards3">
          {posts.map((p) => (
            <article key={p.t} className="post">
              <div className="post-art" style={{ background: p.bg }}><Art kind={p.art} /></div>
              <small className="eyebrow">{p.tag.toUpperCase()} · {p.date.toUpperCase()}</small>
              <h3>{p.t}</h3>
              <p className="muted">{p.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="foot">
        <div className="wrap foot-grid">
          <a className="brand big" href="#/"><Logo size={30} /> <span>EVA</span></a>
          {Object.entries(footer).map(([h, links]) => (
            <div key={h}>
              <h4>{h.toUpperCase()}</h4>
              <ul>{links.map((l) => <li key={l}><a href="#/">{l}</a></li>)}</ul>
            </div>
          ))}
        </div>
        <div className="foot-mark" aria-hidden="true">EVA</div>
      </footer>
    </div>
  );
}
