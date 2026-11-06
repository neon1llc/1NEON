// Documents hub. Uploads go straight to the organization's folder with a presigned link and are scanned before anyone can open them.
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { Empty, LayerBadge, LAYERS, layerName } from "../components/ui.tsx";

/** Placeholder until uploads open: shows the layers files will be filed under. */
export function Documents() {
  const { org } = useOrg();
  useTopBar(<span>{org.name} · Documents</span>, [org.name]);
  return (
    <>
      <h1 className="page-title">Documents</h1>
      <p className="lead">Files for {org.name}, kept in its own private folder and filed by layer. Every upload is checked for malware before anyone can open it.</p>
      <div className="grid" style={{ marginBottom: 24 }}>
        {LAYERS.map((l) => (
          <div key={l} className="card hub">
            <h3><span style={{ display: "flex", gap: 8, alignItems: "center" }}><LayerBadge layer={l} />{layerName(l)}</span><span className="big">0</span></h3>
            <p>{l === "needs" ? "Contracts, exports, examples" : l === "execution" ? "Designs, change records" : l === "observation" ? "Reports, before and after" : "Runbooks, handoff docs"}</p>
          </div>
        ))}
      </div>
      <Empty text="Uploads open once file scanning is switched on for this portal. Until then, send files through your usual channel with neon1." />
    </>
  );
}
