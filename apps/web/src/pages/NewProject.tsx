// New project: a short wizard. Template, the basics, how we'll measure it, then review.
import { TEMPLATES } from "@1neon/domain";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { problem, useRefresh } from "../lib/hooks.ts";
import type { Project } from "@1neon/domain";

// The wizard's steps, in order.
const STEPS = ["Template", "Basics", "Measures", "Review"] as const;

/** A measure as typed; numbers are parsed on submit. */
interface MetricDraft {
  title: string;
  unit: string;
  baseline: string;
  target: string;
}

export function NewProject() {
  const { org, summary, canWrite } = useOrg();
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState("blank");
  const [name, setName] = useState("");
  const [projectSummary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("");
  const [example, setExample] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [metrics, setMetrics] = useState<MetricDraft[]>([{ title: "", unit: "", baseline: "", target: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useTopBar(<span><Link to={`/o/${summary.slug}/projects`}>Projects</Link> / New</span>, [summary.slug]);

  // Viewers can open the page by URL but can't create.
  if (!canWrite) return <p className="lead">Viewers can't start projects. Ask an editor or admin in {org.name}.</p>;
  const t = TEMPLATES.find((x) => x.id === template) ?? TEMPLATES[0]!;
  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));
  // Only the Basics step has a required field.
  const ready = [true, name.trim().length > 0, true, true];

  // Create the project with its starter items and measures, then open it.
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const p = await api<Project>(`/t/${org.id}/projects`, {
        method: "POST",
        body: {
          name: name.trim(),
          template,
          summary: projectSummary,
          outcome,
          example,
          targetDate: targetDate || undefined,
          metrics: metrics.filter((m) => m.title.trim()).map((m) => ({ title: m.title.trim(), unit: m.unit, baseline: num(m.baseline), target: num(m.target) })),
        },
      });
      refresh();
      toast(`${p.key} created`);
      nav(`/o/${summary.slug}/projects/${p.key}`);
    } catch (e) {
      setError(problem(e));
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page-title">New project</h1>
      <div className="steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <span key={s} className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>{i + 1}. {s}</span>
        ))}
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (step < STEPS.length - 1) setStep(step + 1);
          else void create();
        }}
      >
        {/* Step 1: template */}
        {step === 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="muted small" style={{ marginBottom: 10 }}>Start from a template. It adds the usual questions, checks, and measures, and you can change all of them.</legend>
            <div className="options">
              {TEMPLATES.map((x) => (
                <label key={x.id} className={`card option${template === x.id ? " rec" : ""}`} style={{ cursor: "pointer", padding: 16 }}>
                  <input type="radio" name="template" value={x.id} checked={template === x.id} onChange={() => setTemplate(x.id)} className="sr" />
                  <span className="tag">{x.keyPrefix}</span>
                  <h4>{x.name}</h4>
                  <span className="muted small">{x.summary}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {/* Step 2: basics */}
        {step === 1 && (
          <>
            <div><label htmlFor="n">Name</label><input id="n" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus placeholder="Move the file server to the cloud" /></div>
            <div><label htmlFor="s">In one or two sentences, what is this?</label><textarea id="s" value={projectSummary} onChange={(e) => setSummary(e.target.value)} maxLength={500} rows={2} /></div>
            <div><label htmlFor="o">What will be true when it's done?</label><textarea id="o" value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={500} rows={2} /></div>
            <div><label htmlFor="x">One real example of how it works today</label><textarea id="x" value={example} onChange={(e) => setExample(e.target.value)} maxLength={2000} rows={3} placeholder="Every Monday, Dana exports the schedule to a spreadsheet and emails it to the front desk…" /></div>
            <div><label htmlFor="d">Target date (optional)</label><input id="d" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={{ maxWidth: 220 }} /></div>
          </>
        )}
        {/* Step 3: measures */}
        {step === 2 && (
          <>
            <p className="muted small" style={{ margin: 0 }}>How will we know it worked? Add a measure with where it is now and where it should be. You can add readings later.</p>
            {metrics.map((m, i) => {
              const set = (patch: Partial<MetricDraft>) => setMetrics(metrics.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="card" style={{ padding: 14, display: "grid", gap: 10, gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
                  <div><label htmlFor={`mt${i}`}>Measure</label><input id={`mt${i}`} value={m.title} onChange={(e) => set({ title: e.target.value })} placeholder="Hours a week on scheduling" /></div>
                  <div><label htmlFor={`mu${i}`}>Unit</label><input id={`mu${i}`} value={m.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="hours" /></div>
                  <div><label htmlFor={`mb${i}`}>Now</label><input id={`mb${i}`} inputMode="decimal" value={m.baseline} onChange={(e) => set({ baseline: e.target.value })} /></div>
                  <div><label htmlFor={`mg${i}`}>Target</label><input id={`mg${i}`} inputMode="decimal" value={m.target} onChange={(e) => set({ target: e.target.value })} /></div>
                </div>
              );
            })}
            {metrics.length < 10 && <button type="button" className="btn btn-ghost" style={{ justifySelf: "start" }} onClick={() => setMetrics([...metrics, { title: "", unit: "", baseline: "", target: "" }])}>Add another measure</button>}
          </>
        )}
        {/* Step 4: review */}
        {step === 3 && (
          <div className="card">
            <p className="s mono muted small" style={{ margin: 0 }}>{t.keyPrefix}-· · {t.name}</p>
            <h2 style={{ margin: "6px 0 10px" }}>{name}</h2>
            {projectSummary && <p>{projectSummary}</p>}
            {outcome && <p><b>Done when:</b> {outcome}</p>}
            <p className="muted small">Starts in {org.stages[0]?.name}. Adds {t.items.length} template items and {metrics.filter((m) => m.title.trim()).length} measures.</p>
          </div>
        )}
        {error && <p className="notice" role="alert">{error}</p>}
        <div className="actions" style={{ justifyContent: "flex-start" }}>
          {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn btn-primary" type="submit" disabled={!ready[step] || busy}>{step < STEPS.length - 1 ? "Next" : busy ? "Creating…" : "Create project"}</button>
        </div>
      </form>
    </>
  );
}
