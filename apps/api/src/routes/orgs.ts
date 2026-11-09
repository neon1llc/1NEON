// apps/api/src/routes/orgs.ts - Operator routes outside any one organization: creating an
// organization, and the read-only All clients view.


import { CreateTenantInput, DEFAULT_STAGES, can, formatClientId, newId, slugify, type Tenant } from "@1neon/domain";
import { body, check, fail, now, who } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { ConflictError } from "../store/types.ts";


export function orgRoutes(app: App, k: Kit) {
  const { repo } = k;

  // Create an organization with the default stages and the next client ID
  app.post("/orgs", async (c) => {
    const { actor, user } = who(c);
    check(can(actor, "manage_orgs", undefined));
    const input = await body(c, CreateTenantInput);
    const n = await repo.nextClientNumber();
    const t = now();
    const tenant: Tenant = {
      id: newId("t"),
      slug: input.slug ?? slugify(input.name),
      clientId: formatClientId(n),
      name: input.name,
      status: "active",
      stages: DEFAULT_STAGES,
      version: 1,
      createdAt: t,
      updatedAt: t,
      updatedBy: user.id,
    };
    try {
      await repo.createTenant(tenant);
    } catch (e) {
      if (e instanceof ConflictError) fail(409, "slug_taken", `The address "${tenant.slug}" is taken. Choose another.`);
      throw e;
    }
    await repo.table.write([repo.auditOp({ tenantId: tenant.id, actorId: user.id, action: "org.created", target: tenant.id, summary: `Created ${tenant.name} (${tenant.clientId})` })]);
    return c.json(tenant, 201);
  });

  // All clients: every active project across organizations, read only
  app.get("/all/projects", async (c) => {
    check(can(who(c).actor, "read", undefined, "all"));
    const [tenants, projects] = await Promise.all([repo.listTenants(), repo.listAllProjects()]);
    const byId = new Map(tenants.map((t) => [t.id, t]));
    return c.json({
      orgs: tenants.map((t) => ({ id: t.id, slug: t.slug, name: t.name, clientId: t.clientId, stages: t.stages })),
      projects: projects.filter((p) => byId.get(p.tenantId)?.status === "active" && !p.archived),
      stages: DEFAULT_STAGES,
    });
  });

  // Any write under /all is refused outright: the aggregate is a view, never a place to edit
  app.on(["POST", "PUT", "PATCH", "DELETE"], "/all/*", (c) => {
    check(can(who(c).actor, "write", undefined, "all"));
    return c.notFound();
  });
}
