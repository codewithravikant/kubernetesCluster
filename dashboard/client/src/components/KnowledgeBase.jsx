import { getKnowledgePage, KNOWLEDGE_TOPICS } from "./knowledgeContent.js";

const LABELS = {
  overview: "Overview",
  host: "Host",
  minikube: "Minikube",
  ingress: "Ingress",
  app: "app",
  frontend: "frontend",
  backend: "backend",
  monitoring: "monitoring",
  logging: "logging",
  cicd: "cicd",
};

export default function KnowledgeBase({ topic, onSelectTopic }) {
  const page = getKnowledgePage(topic);

  return (
    <section className="panel knowledge-book" aria-label="Kubernetes knowledge base">
      <div className="kb-spine" aria-hidden="true" />
      <div className="kb-page">
        <header className="kb-header">
          <div>
            <p className="kb-eyebrow">Field guide</p>
            <h2>{page.title}</h2>
          </div>
          <nav className="kb-tabs" aria-label="Knowledge topics">
            {KNOWLEDGE_TOPICS.filter((t) => t !== "overview").map((t) => (
              <button
                key={t}
                type="button"
                className={`kb-tab${page.key === t ? " active" : ""}`}
                onClick={() => onSelectTopic?.(t)}
              >
                {LABELS[t] || t}
              </button>
            ))}
            <button
              type="button"
              className={`kb-tab${page.key === "overview" ? " active" : ""}`}
              onClick={() => onSelectTopic?.("overview")}
            >
              Overview
            </button>
          </nav>
        </header>

        <p className="kb-intro">{page.intro}</p>

        <div className="kb-columns">
          {page.sections.map((section) => (
            <article key={section.heading} className="kb-section">
              <h3>{section.heading}</h3>
              <ul className="kb-list">
                {section.items.map((item) => (
                  <li key={`${section.heading}-${item.cmd}`}>
                    <code className="kb-cmd">{item.cmd}</code>
                    <span className="kb-why">{item.why}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
