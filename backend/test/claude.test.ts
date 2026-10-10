import { describe, expect, it } from "vitest";
import { handleClaude } from "../src/claude";
import { decide, disconnect, listConnected, markConnected, recordRequest, requestByState, stillConnected } from "../src/mcp/jungtys";
import { handleMcp, MCP_TOOLS, type McpProps } from "../src/mcp/serveris";
import { visaBaze } from "./d1-node";

const JONAS = 1;
const RŪTA = 2;
const NOW = new Date("2026-10-10T06:00:00Z");
const PROPS: McpProps = { jungtisId: 1, memberId: JONAS };

const db = () => visaBaze();

let nextId = 1;
async function rpc(d: D1Database, method: string, params?: Record<string, unknown>, props = PROPS) {
  const res = await handleMcp(
    new Request("https://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) }),
    d,
    props,
    NOW
  );
  return (await res.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}

async function call(d: D1Database, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(d, "tools/call", { name, arguments: args });
  const result = r.result as { content: { text: string }[]; isError?: boolean };
  return { text: result.content[0].text, isError: result.isError ?? false };
}

describe("MCP protokolas", () => {
  it("initialize — palaikoma versija grąžinama ta pati, nežinoma — naujausia; su instrukcijomis", async () => {
    const d = db();
    const a = await rpc(d, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai" } });
    expect(a.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "namai" } });
    expect(String(a.result!.instructions)).toContain("get_overview");
    const b = await rpc(d, "initialize", { protocolVersion: "1999-01-01" });
    expect(b.result!.protocolVersion).toBe("2025-11-25");
  });

  it("pranešimai — 202 be turinio; GET — 405; neteisingas JSON — klaida; nežinomas metodas — -32601", async () => {
    const d = db();
    const note = await handleMcp(new Request("https://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }), d, PROPS);
    expect(note.status).toBe(202);
    expect((await handleMcp(new Request("https://x/mcp"), d, PROPS)).status).toBe(405);
    const bad = await handleMcp(new Request("https://x/mcp", { method: "POST", body: "{" }), d, PROPS);
    expect(bad.status).toBe(400);
    expect((await rpc(d, "resources/list")).error?.code).toBe(-32601);
    expect((await rpc(d, "ping")).result).toEqual({});
  });

  it("tools/list — skaitymo ir rašymo įrankiai su schemomis; finansai — tik skaitymas", async () => {
    const r = await rpc(db(), "tools/list");
    const tools = r.result!.tools as typeof MCP_TOOLS;
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_overview", "get_project", "create_project", "update_project", "set_project_budget_line", "create_task", "finance_months"]));
    expect(tools.find((t) => t.name === "finance_months")!.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "delete_task")!.annotations.destructiveHint).toBe(true);
    const create = tools.find((t) => t.name === "create_project")!.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(create.properties)).toEqual(expect.arrayContaining(["sections", "costs", "notes"]));
  });

  it("nežinomas įrankis — -32602", async () => {
    expect((await rpc(db(), "tools/call", { name: "drop_tables" })).error?.code).toBe(-32602);
  });
});

describe("MCP įrankiai", () => {
  it("get_overview — tas pats kontekstas, kaip katinuko, „aš“ — prisijungęs narys", async () => {
    const r = await call(db(), "get_overview");
    expect(r.text).toContain("Kalba: Jonas (id 1)");
    expect(r.text).toContain("## Kalendorius");
    expect(r.text).toContain("## Pirkinių sąrašai");
  });

  it("create_project — visas planas su pastabomis, šaltinis „claude“; get_project parodo viską", async () => {
    const d = db();
    const r = await call(d, "create_project", {
      title: "Emos gimtadienis",
      goal: "Žaidimų kambaryje, ~12 vaikų",
      target_date: "2026-11-14",
      budget_eur: 300,
      notes: "Vietos: Linksmoji planeta (25 €/vaikui), Batutų parkas.",
      sections: [
        { name: "Vieta", tasks: [{ title: "Užsakyti žaidimų kambarį", due_date: "2026-10-20", amount_eur: 150 }] },
        { name: "Maistas", tasks: [{ title: "Užsakyti tortą", due_date: "2026-11-09" }] },
      ],
      costs: [{ name: "Tortas", planned_eur: 60, is_estimate: true, task_title: "Užsakyti tortą" }],
    });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/Sukurtas projektas #\d+ „Emos gimtadienis“: etapų 2, darbų 2, biudžeto eilučių 1/);
    const project = await d.prepare("SELECT id, source, notes, created_by FROM projects").first<{ id: number; source: string; notes: string; created_by: number }>();
    expect(project).toMatchObject({ source: "claude", notes: "Vietos: Linksmoji planeta (25 €/vaikui), Batutų parkas.", created_by: JONAS });
    const { results } = await d.prepare("SELECT DISTINCT source FROM tasks WHERE project_id = ?").bind(project!.id).all<{ source: string }>();
    expect(results).toEqual([{ source: "claude" }]);

    const p = await call(d, "get_project", { project_id: project!.id });
    expect(p.text).toContain("Pastabos: Vietos: Linksmoji planeta");
    expect(p.text).toMatch(/### \[\d+\] Vieta\n- #\d+ Užsakyti žaidimų kambarį \| terminas 2026-10-20/);
    expect(p.text).toMatch(/- \[\d+\] Tortas: planas 60 € \(įvertis\), faktas — \(darbas #\d+\)/);
    expect(p.text).toMatch(/- \[\d+\] Užsakyti žaidimų kambarį: planas 150 € \(įvertis\)/);
  });

  it("į esamą projektą: darbas į naują etapą, plano eilutė, projekto pakeitimai", async () => {
    const d = db();
    await call(d, "create_project", { title: "Gimtadienis", target_date: "2026-11-14", sections: [{ name: "Vieta", tasks: [] }] });
    const projectId = (await d.prepare("SELECT id FROM projects").first<{ id: number }>())!.id;

    const t = await call(d, "create_task", { title: "Nupirkti balionų", project_id: projectId, section: "Dekoracijos", due_date: "2026-11-12" });
    expect(t.text).toMatch(/Sukurta užduotis #\d+ „Nupirkti balionų“ \(etapas „Dekoracijos“\)/);
    const task = await d.prepare("SELECT t.source, s.name FROM tasks t JOIN project_sections s ON s.id = t.section_id").first();
    expect(task).toEqual({ source: "claude", name: "Dekoracijos" });

    const line = await call(d, "set_project_budget_line", { project_id: projectId, name: "Balionai", planned_eur: 25 });
    expect(line.text).toMatch(/Pridėta biudžeto eilutė \[(\d+)\] „Balionai“: planas 25 €/);
    const costId = Number(line.text.match(/\[(\d+)\]/)![1]);
    expect(await d.prepare("SELECT planned_cents, is_estimate FROM project_costs WHERE id = ?").bind(costId).first()).toEqual({ planned_cents: 2500, is_estimate: 1 });
    await call(d, "set_project_budget_line", { project_id: projectId, cost_id: costId, planned_eur: 30, is_estimate: false });
    expect(await d.prepare("SELECT planned_cents, is_estimate FROM project_costs WHERE id = ?").bind(costId).first()).toEqual({ planned_cents: 3000, is_estimate: 0 });

    const u = await call(d, "update_project", { project_id: projectId, budget_eur: 350, notes: "Svečių sąrašas: 12 vaikų" });
    expect(u.text).toBe(`Projektas #${projectId} „Gimtadienis“ pakeistas.`);
    expect(await d.prepare("SELECT budget_cents, notes, target_date FROM projects").first()).toEqual({ budget_cents: 35000, notes: "Svečių sąrašas: 12 vaikų", target_date: "2026-11-14" });

    const cost = await call(d, "record_project_cost", { project_id: projectId, cost_id: costId, actual_eur: 28 });
    expect(cost.text).toContain("Balionai — 28 €");
  });

  it("klaidos grąžinamos kaip įrankio klaida (Claude parodys žmogui)", async () => {
    const d = db();
    expect(await call(d, "create_task", { title: "X", assignee_id: 99 })).toEqual({ text: "Tokio šeimos nario nėra.", isError: true });
    expect(await call(d, "get_project", { project_id: 5 })).toMatchObject({ isError: true });
    expect(await call(d, "update_project", {})).toEqual({ text: "Nenurodytas projektas (project_id).", isError: true });
    expect(await call(d, "set_project_budget_line", { project_id: 1, cost_id: 7, planned_eur: 1 })).toMatchObject({ isError: true });
  });

  it("pirkiniai ir pastaba — įrašoma iš karto; pastaba pažymėta „Claude programa“", async () => {
    const d = db();
    const list = await d.prepare("SELECT id FROM shopping_lists WHERE name = 'Maistas'").first<{ id: number }>();
    const r = await call(d, "add_shopping_items", { list_id: list!.id, items: [{ name: "pienas", quantity: "2 l" }] });
    expect(r.text).toBe("Į sąrašą „Maistas“ pridėta: pienas (2 l).");
    await call(d, "save_feedback", { kind: "ideja", text: "Rodyti projektų kalendorių" });
    expect(await d.prepare("SELECT kind, screen, member_id FROM feedback").first()).toEqual({ kind: "ideja", screen: "Claude programa", member_id: JONAS });
  });

  it("finansų įrankiai — tik skaitymas, atsako tekstu", async () => {
    const r = await call(db(), "credits");
    expect(r.isError).toBe(false);
    expect(typeof r.text).toBe("string");
  });
});

describe("Claude jungtys", () => {
  const client = { clientId: "c1", clientName: "Claude", redirectHost: "claude.ai", localApp: false };

  it("prašymas → leista → prijungta → atjungta; senas leidimas pakeičiamas nauju", async () => {
    const d = db();
    await recordRequest(d, "state-1", client, NOW);
    expect(await requestByState(d, "state-1")).toMatchObject({ status: "laukia", client_name: "Claude", redirect_host: "claude.ai" });
    expect(await requestByState(d, "kitas")).toBeNull();

    await expect(decide(d, "state-1", null, true, NOW)).rejects.toThrow("kas jungiasi");
    const j = await decide(d, "state-1", JONAS, true, NOW);
    expect(j).toMatchObject({ status: "leista", member_id: JONAS });
    await expect(decide(d, "state-1", JONAS, true, NOW)).rejects.toThrow("jau išspręstas");
    await markConnected(d, j, NOW);
    expect(await stillConnected(d, j.id, NOW)).toBe(true);

    // Tas pats narys iš tos pačios programos jungiasi iš naujo — senoji atjungiama.
    await recordRequest(d, "state-2", client, NOW);
    const j2 = await decide(d, "state-2", JONAS, true, NOW);
    await markConnected(d, j2, NOW);
    expect(await stillConnected(d, j.id, NOW)).toBe(false);
    expect((await listConnected(d)).map((x) => [x.id, x.member_name])).toEqual([[j2.id, "Jonas"]]);

    await disconnect(d, j2.id, NOW);
    expect(await stillConnected(d, j2.id, NOW)).toBe(false);
    await expect(disconnect(d, j2.id, NOW)).rejects.toThrow("Tokios prijungtos");
  });

  it("pasibaigęs prašymas (po 10 min.) — nebeleidžiama", async () => {
    const d = db();
    await recordRequest(d, "s", client, NOW);
    await expect(decide(d, "s", JONAS, true, new Date(NOW.getTime() + 11 * 60_000))).rejects.toThrow("pasibaigė");
  });

  it("appso API: prašymo informacija, leidimas, sąrašas, atjungimas; grįžimas — tik į savo adresą", async () => {
    const d = db();
    const env = { DB: d, MCP_URL: "https://mcp.test" };
    const api = async (path: string, init?: RequestInit) => {
      const url = new URL(`https://app.test${path}`);
      const res = await handleClaude(url, new Request(url, init), env);
      return { status: res!.status, body: (await res!.json()) as Record<string, unknown> };
    };
    await recordRequest(d, "abc", { ...client, localApp: true });

    const info = await api("/api/claude/prasymas?state=abc");
    expect(info.body).toMatchObject({ programa: "Claude", adresas: "claude.ai", vietine: true, busena: "laukia", pasibaige: false, toliau: "https://mcp.test/callback?state=abc" });
    expect((await api("/api/claude/prasymas?state=nera")).status).toBe(400);

    const post = (body: unknown) => api("/api/claude/prasymas", { method: "POST", body: JSON.stringify(body) });
    expect((await post({ state: "abc", narys: 99, leisti: true })).body.klaida).toBe("Tokio šeimos nario nėra.");
    expect((await post({ state: "abc", narys: RŪTA, leisti: true })).body).toEqual({ toliau: "https://mcp.test/callback?state=abc" });
    const j = (await requestByState(d, "abc"))!;
    expect(j).toMatchObject({ status: "leista", member_id: RŪTA });
    await markConnected(d, j);

    const list = await api("/api/claude/jungtys");
    expect(list.body).toMatchObject({ adresas: "https://mcp.test/mcp", jungtys: [{ id: j.id, programa: "Claude", narys: "Rūta" }] });
    expect((await api(`/api/claude/jungtys/${j.id}/atjungti`, { method: "POST" })).body).toEqual({ ok: true });
    expect((await api("/api/claude/jungtys")).body.jungtys).toEqual([]);
  });

  it("neleista — būsena „atmesta“, narys neįrašomas", async () => {
    const d = db();
    await recordRequest(d, "n", client, NOW);
    expect(await decide(d, "n", null, false, NOW)).toMatchObject({ status: "atmesta", member_id: null });
  });
});
