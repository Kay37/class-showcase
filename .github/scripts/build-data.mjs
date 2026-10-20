// Builds data/class.json from the "Add me" forms: who opted in, which repos they picked,
// plus every public repo of the classmates in config.js, preloaded but not shown, so their picks appear at once, each repo's files and main file,
// and which repos are the same assignment. It runs in a GitHub Action (deploy.yml) with the Action's
// token, so visitors don't each spend GitHub's 60-requests-an-hour limit.
// Locally: GITHUB_TOKEN=$(gh auth token) node .github/scripts/build-data.mjs  (run from the site folder)
import fs from "node:fs";
import vm from "node:vm";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Set GITHUB_TOKEN first.");
  process.exit(1);
}
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync("config.js", "utf8"), sandbox);
const cfg = sandbox.window.SHOWCASE;
const SITE = cfg.siteRepo;
const NAME = /^[A-Za-z0-9_.-]+$/;

// Keep these two in step with app.js.
const HIDDEN_DIRS = new Set([".idea", ".git", ".mvn", "target", "out", "build", "bin", ".gradle", "node_modules"]);
const BINARY = /\.(class|jar|war|zip|png|jpe?g|gif|ico|pdf|exe|dll|iml|DS_Store)$/i;

async function gh(path) {
  const res = await fetch("https://api.github.com" + path, {
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
  });
  if (res.status === 404 || res.status === 409) return null; // missing, or an empty repo
  if (!res.ok) throw new Error("GitHub said " + res.status + " for " + path);
  return res.json();
}

async function raw(owner, repo, path) {
  const res = await fetch("https://raw.githubusercontent.com/" + owner + "/" + repo + "/HEAD/" +
    path.split("/").map(encodeURIComponent).join("/"));
  return res.ok ? res.text() : "";
}

// An "Add me" form body looks like "### Projects to show\n\nrepo-one\nrepo-two".
// Only the author's own repos count. An empty form means "all my Java repos" (null).
function parsePicks(body, login) {
  const text = String(body || "").split(/###\s*Projects to show/i).pop();
  const names = new Set();
  for (let line of text.split("\n")) {
    line = line.trim().replace(/^[-*]\s*/, "").replace(/^https?:\/\/github\.com\//i, "");
    if (line.includes("/")) {
      const [owner, name] = line.split("/");
      if (owner.toLowerCase() !== login.toLowerCase()) continue;
      line = name;
    }
    if (NAME.test(line)) names.add(line.toLowerCase());
  }
  return names.size ? names : null;
}

// Last run's data, so unchanged repos skip the file lookups.
async function previousRepos() {
  const [owner, repo] = SITE.split("/");
  const before = new Map();
  try {
    const res = await fetch("https://" + owner.toLowerCase() + ".github.io/" + repo + "/data/class.json");
    if (res.ok) {
      const old = await res.json();
      for (const p of [...old.people, ...(old.preloaded || [])]) {
        for (const r of p.repos) before.set((p.login + "/" + r.name).toLowerCase(), r);
      }
    }
  } catch (e) { /* first run */ }
  return before;
}

async function describe(r, old) {
  const base = { name: r.name, description: r.description || "", language: r.language || "", pushedAt: r.pushed_at };
  if (old && old.pushedAt === r.pushed_at && Array.isArray(old.files)) return { ...base, files: old.files, main: old.main };
  let tree = null;
  try { tree = await gh("/repos/" + r.full_name + "/git/trees/HEAD?recursive=1"); } catch (e) { console.warn(e.message); }
  const files = (tree ? tree.tree : [])
    .filter((t) => t.type === "blob" && !BINARY.test(t.path) && t.size < 400000)
    .filter((t) => !t.path.split("/").some((part) => HIDDEN_DIRS.has(part)))
    .map((t) => t.path);
  // Open the file with main() first; class projects usually have just a few .java files.
  const java = files.filter((f) => f.endsWith(".java")).slice(0, 15);
  let main = null;
  for (const f of java) {
    if (/static\s+void\s+main\s*\(/.test(await raw(r.owner.login, r.name, f))) { main = f; break; }
  }
  return { ...base, files, main: main || java[0] || files.find((f) => /readme/i.test(f)) || files[0] || null };
}

// ---------- same assignment, different names ----------

function assignmentKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(workbook|wb)\d*[a-z]?/, "");
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.length];
}

// "basic-calulator" ~ "basicCalculator", "rental-car" ~ "rental-car-calculator", but "exercise-2" !~ "exercise-3".
function similar(a, b) {
  if (a === b) return true;
  const num = (s) => (s.match(/\d+$/) || [""])[0];
  if (num(a) !== num(b)) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 8 && long.includes(short)) return true;
  return short.length >= 6 && distance(a, b) <= 2;
}

function groupAssignments(people) {
  const entries = []; // { login, repo, key }
  for (const p of people) for (const r of p.repos) entries.push({ login: p.login, repo: r, key: assignmentKey(r.name) });
  const keys = [...new Set(entries.map((e) => e.key))].filter(Boolean);
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k) => (parent.get(k) === k ? k : find(parent.get(k)));
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (similar(keys[i], keys[j])) parent.set(find(keys[i]), find(keys[j]));
    }
  }
  const groups = new Map();
  for (const e of entries) {
    if (!e.key) continue;
    const root = find(e.key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(e);
  }
  const out = [];
  for (const list of groups.values()) {
    // One repo per person: their newest.
    const byPerson = new Map();
    for (const e of list) {
      const have = byPerson.get(e.login);
      if (!have || e.repo.pushedAt > have.repo.pushedAt) byPerson.set(e.login, e);
    }
    if (byPerson.size < 2) continue;
    const counts = new Map();
    for (const e of list) counts.set(e.repo.name, (counts.get(e.repo.name) || 0) + 1);
    const label = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    const keyCounts = new Map();
    for (const e of list) keyCounts.set(e.key, (keyCounts.get(e.key) || 0) + 1);
    const key = [...keyCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const members = [...byPerson.values()]
      .sort((a, b) => b.repo.pushedAt.localeCompare(a.repo.pushedAt))
      .map((e) => ({ login: e.login, repo: e.repo.name }));
    out.push({ key, label, members });
  }
  return out.sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));
}

// ---------- main ----------

const picks = new Map(); // lowercase login -> { login, repos: null or Set }
const issues = (await gh("/repos/" + SITE + "/issues?labels=showcase&state=open&sort=created&direction=desc&per_page=100")) || [];
for (const issue of issues) {
  if (issue.pull_request) continue;
  // Issues the sign-in server writes are opened by the owner's token and name the person in a marker line.
  const marker = String(issue.body || "").match(/<!--\s*login:\s*([A-Za-z0-9_.-]+)\s*-->/);
  const login = marker && issue.user.login.toLowerCase() === SITE.split("/")[0].toLowerCase() ? marker[1] : issue.user.login;
  if (!picks.has(login.toLowerCase())) picks.set(login.toLowerCase(), { login, repos: parsePicks(issue.body, login) });
}

for (const u of cfg.classmates || []) {
  if (NAME.test(u) && !picks.has(u.toLowerCase())) picks.set(u.toLowerCase(), { login: u, repos: null, preloadOnly: true });
}

const before = await previousRepos();
const people = [];    // opted in: shown in the gallery
const preloaded = []; // everyone known, with all their public repos: for the Add me picker and instant picks
for (const p of picks.values()) {
  const list = await gh("/users/" + p.login + "/repos?type=owner&sort=pushed&per_page=100");
  if (!list) {
    console.warn("No GitHub user named " + p.login);
    continue;
  }
  const login = list[0] ? list[0].owner.login : p.login;
  const all = [];
  for (const r of list) {
    if (r.private || r.fork || r.full_name.toLowerCase() === SITE.toLowerCase()) continue;
    all.push(await describe(r, before.get(r.full_name.toLowerCase())));
  }
  preloaded.push({ login, repos: all });
  if (p.preloadOnly) continue;
  const shown = all.filter((r) => (p.repos === null ? r.language === "Java" : p.repos.has(r.name.toLowerCase())));
  people.push({ login, picked: p.repos !== null, repos: shown });
}

const data = { generatedAt: new Date().toISOString(), people, preloaded, assignments: groupAssignments(people) };
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/class.json", JSON.stringify(data));
console.log(people.length + " people shown, " + preloaded.length + " preloaded, " + people.reduce((n, p) => n + p.repos.length, 0) + " repos, " +
  data.assignments.length + " shared assignments");
