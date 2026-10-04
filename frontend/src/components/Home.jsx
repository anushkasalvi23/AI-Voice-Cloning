import { api } from "../api.js";
import { pageHref, useResource, useStudio } from "../studio.jsx";
import { Empty, ErrorState, Icon, PlayButton, Skeleton, fmtAgo, fmtBytes, fmtClock, fmtLength } from "./ui.jsx";

const ACTIONS = [
  { page: "create", art: "g1", icon: "mic", title: "Clone a voice", text: "Upload or record a sample and get a reusable voice." },
  { page: "generate", art: "g2", icon: "wave", title: "Generate speech", text: "Type anything and hear it in one of your voices." },
  { page: "library", art: "g3", icon: "library", title: "Open library", text: "Play, favorite and manage voices and saved clips." },
];

// Quick-link card with a gradient thumbnail, shared by Home and Create.
export function ActionCard({ page, sub, art, icon, title, text }) {
  return (
    <a className="action" href={pageHref(page, sub)}>
      <span className={`action-art ${art}`}><Icon name={icon} size={22} /></span>
      <span className="action-text"><b>{title}</b><small>{text}</small></span>
      <Icon name="arrow" size={18} />
    </a>
  );
}

const fetchActivity = () => api.activity(8);

export default function Home() {
  const { user } = useStudio();
  const stats = useResource(api.stats, null);
  const activity = useResource(fetchActivity, []);

  const s = stats.data;
  const tiles = s && [
    { icon: "mic", label: "Cloned voices", value: s.voices },
    { icon: "wave", label: "Generated clips", value: s.clips, note: `${s.saved_clips} saved to library` },
    { icon: "clock", label: "Audio generated", value: fmtLength(s.generated_seconds) },
    { icon: "disk", label: "Storage used", value: fmtBytes(s.storage.total) },
  ];
  const isNew = s && s.voices === 0 && s.clips === 0;

  return (
    <>
      <header className="page-head">
        <h2>Welcome{isNew ? "" : " back"}, {user.name.split(/[\s@]/)[0]}</h2>
        <p>Clone a voice from a short sample, then make it say anything.</p>
      </header>

      <section aria-labelledby="start">
        <h3 id="start" className="section-title">Get started</h3>
        <div className="actions">{ACTIONS.map((a) => <ActionCard key={a.page} {...a} />)}</div>
      </section>

      <section aria-labelledby="overview">
        <h3 id="overview" className="section-title">Overview</h3>
        {stats.status === "error" ? (
          <div className="card"><ErrorState message={stats.error} onRetry={stats.load} /></div>
        ) : !tiles ? (
          <div className="tiles" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="sk sk-tile" />)}</div>
        ) : (
          <div className="tiles">
            {tiles.map((t) => (
              <div key={t.label} className="tile">
                <span className="tile-label"><Icon name={t.icon} size={16} /> {t.label}</span>
                <b>{t.value}</b>
                {t.note && <small>{t.note}</small>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="recent">
        <h3 id="recent" className="section-title">Recent activity</h3>
        <div className="card flush">
          {activity.status === "loading" ? (
            <Skeleton rows={4} />
          ) : activity.status === "error" ? (
            <ErrorState message={activity.error} onRetry={activity.load} />
          ) : activity.data.length === 0 ? (
            <Empty icon="mic" title="Nothing here yet"
              action={<a className="btn primary" href={pageHref("create")}>Clone your first voice</a>}>
              Your cloned voices and generated clips will show up here.
            </Empty>
          ) : (
            <ul className="rows">
              {activity.data.map((item) => (
                <li key={`${item.type}:${item.id}`} className="row">
                  <PlayButton id={`${item.type}:${item.id}`} url={item.audio_url && api.mediaUrl(item.audio_url)} label={item.name} />
                  <div className="row-main">
                    <b>{item.name || "Untitled"}</b>
                    <small>{item.type === "voice" ? "Voice cloned" : item.audio_url ? item.text : `Expired · ${item.text}`}</small>
                  </div>
                  <span className={`chip ${item.type}`}>{item.type === "voice" ? "Voice" : "Clip"}</span>
                  <span className="row-meta">{fmtClock(item.duration)}</span>
                  <span className="row-meta wide">{fmtAgo(item.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
