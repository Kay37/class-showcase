// Class Code Showcase: a gallery of class projects on GitHub, a read-only code viewer, and side-by-side compare.
// Routes live in the address hash: #/ gallery, #/add-me pick your projects, #/~compare/<key> compare an
// assignment, #/owner/repo[/path/to/File.java] a project.
// The class list comes from data/class.json, which a GitHub Action rebuilds every 15 minutes
// (.github/scripts/build-data.mjs), so visitors barely touch GitHub's 60-requests-an-hour limit.
(function () {
  "use strict";

  const cfg = window.SHOWCASE || {};
  const app = document.getElementById("app");
  const NAME = /^[A-Za-z0-9_.-]+$/;
  const SITE_REPO = cfg.siteRepo || "Kay37/class-showcase";
  const CACHE_MS = 2 * 60 * 1000;
  const fileCache = new Map();
  let data = null; // { at, promise } for data/class.json
  let current = null; // the open project: { owner, repo, files, main }
  let commentCounts = {}; // "owner/repo" (lowercase) -> number of comments, from the class list
  let justAdded = null; // login of someone who just finished "Add me" in this tab

  // Folders and files an IntelliJ project has that nobody needs to read. Keep in step with build-data.mjs.
  const HIDDEN_DIRS = new Set([".idea", ".git", ".mvn", "target", "out", "build", "bin", ".gradle", "node_modules"]);
  const BINARY = /\.(class|jar|war|zip|png|jpe?g|gif|ico|pdf|exe|dll|iml|DS_Store)$/i;
  const LANGS = { java: "java", xml: "xml", md: "markdown", properties: "ini", json: "json", txt: "plaintext",
                  csv: "plaintext", yml: "yaml", yaml: "yaml", sql: "sql", html: "xml", css: "css", js: "javascript" };

  document.getElementById("brand").textContent = cfg.title || "Class Code Showcase";
  document.getElementById("open-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("open-input");
    const repo = parseRepoLink(input.value);
    if (repo) {
      input.value = "";
      location.hash = "#/" + repo.owner + "/" + repo.repo;
    } else {
      input.setCustomValidity("Paste a link like github.com/name/project");
      input.reportValidity();
      input.addEventListener("input", () => input.setCustomValidity(""), { once: true });
    }
  });
  window.addEventListener("hashchange", route);
  route();

  // ---------- routing ----------

  function route() {
    const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length === 1 && parts[0] === "add-me") {
      showAddMe(query);
    } else if (parts.length === 2 && parts[0] === "~compare") {
      showCompare(parts[1]);
    } else if (parts.length >= 2 && NAME.test(parts[0]) && NAME.test(parts[1])) {
      showProject(parts[0], parts[1], parts.slice(2).join("/"), query);
    } else {
      showGallery();
    }
  }

  function parseRepoLink(text) {
    const m = String(text).trim()
      .replace(/^https?:\/\//, "").replace(/^(www\.)?github\.(com|dev)\//, "")
      .match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
    if (!m) return null;
    return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
  }

  // ---------- data ----------

  // The class list, fetched again after a couple of minutes so new "Add me" picks show up.
  function loadData() {
    if (!data || Date.now() - data.at > CACHE_MS) {
      const promise = fetch("data/class.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error("no-data");
        return r.json();
      });
      data = { at: Date.now(), promise };
      promise.catch(() => { data = null; });
    }
    return data.promise;
  }

  function findRepo(d, owner, repo) {
    for (const group of [d.people, d.preloaded || []]) {
      const person = group.find((p) => p.login.toLowerCase() === owner.toLowerCase());
      const r = person && person.repos.find((x) => x.name.toLowerCase() === repo.toLowerCase());
      if (r) return { login: person.login, repo: r };
    }
    return null;
  }

  function findPreloaded(d, login) {
    return (d.preloaded || []).find((p) => p.login.toLowerCase() === login.toLowerCase()) || null;
  }

  // ---------- GitHub (only for repos the class list doesn't have, and for "Add me") ----------

  async function getJson(url, fresh) {
    const cached = fresh ? null : cacheGet(url);
    if (cached) return cached;
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 404) throw new Error("not-found");
    if (res.status === 403 || res.status === 429) throw new Error("rate-limit");
    if (!res.ok) throw new Error("GitHub said " + res.status);
    const json = await res.json();
    cacheSet(url, json);
    return json;
  }

  // File contents come from raw.githubusercontent.com, which doesn't count toward the limit.
  async function getFile(owner, repo, path) {
    const url = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/HEAD/" +
      path.split("/").map(encodeURIComponent).join("/");
    if (!fileCache.has(url)) {
      fileCache.set(url, fetch(url).then((r) => {
        if (!r.ok) throw new Error("Couldn't load " + path);
        return r.text();
      }));
    }
    return fileCache.get(url);
  }

  function cacheGet(key) {
    try {
      const v = JSON.parse(sessionStorage.getItem(key));
      return v && Date.now() - v.at < CACHE_MS ? v.data : null;
    } catch (e) { return null; }
  }
  function cacheSet(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: value })); } catch (e) { /* full or blocked: fine */ }
  }

  function errorText(err) {
    if (err.message === "rate-limit") return "GitHub is limiting requests from your network for a bit. Try again in a few minutes.";
    if (err.message === "not-found") return "That repo wasn't found. It may be private, renamed, or misspelled.";
    if (err.message === "no-data") return "The class list is being built. Try again in a few minutes.";
    return err.message || "Something went wrong.";
  }

  // ---------- gallery ----------

  async function showGallery() {
    current = null;
    document.title = cfg.title || "Class Code Showcase";
    app.innerHTML = "";
    const intro = el("section", "intro");
    const join = el("div", "join");
    const go = el("a", "btn primary", "Add my projects");
    go.href = "#/add-me";
    join.append(el("span", null, "Show your projects here. Pick which ones, one time, and you're set."), go);
    intro.append(
      el("h1", null, "Everyone's projects"),
      el("p", "muted", "Click a project to read its code right here, without downloading or opening IntelliJ."),
      join
    );
    const assignments = el("section", "assignments");
    const list = el("section", "gallery");
    list.append(el("p", "muted", "Loading projects…"));
    app.append(intro, assignments, list);

    let d;
    try {
      d = await withLivePicks(await loadData(), Boolean(justAdded));
    } catch (err) {
      list.replaceChildren(el("p", "error", errorText(err)));
      return;
    }
    commentCounts = d.comments || {};

    const shared = d.assignments.filter((a) => a.members.length >= 2);
    if (shared.length) {
      const chips = el("div", "chips");
      for (const a of shared) {
        const chip = el("a", "chip");
        chip.href = "#/~compare/" + encodeURIComponent(a.key);
        chip.append(el("span", null, a.label), el("span", "chip-count", String(a.members.length)));
        chips.append(chip);
      }
      assignments.append(el("h2", null, "Compare an assignment"),
        el("p", "muted", "See how classmates solved the same project, side by side."), chips);
    }

    const people = d.people.filter((p) => p.repos.length > 0)
      .map((p) => ({ ...p, newest: p.repos.reduce((m, r) => (r.pushedAt > m ? r.pushedAt : m), "") }));
    if (people.length === 0) {
      list.replaceChildren(el("p", "empty", "Nobody has added projects yet. Be the first: click Add my projects."));
      return;
    }

    // View, sort and search. The view and sort are remembered in this browser.
    const prefs = loadPrefs();
    const added = justAdded;
    justAdded = null;
    const open = new Set(added ? [added.toLowerCase()] : []); // which people are expanded

    const toolbar = el("div", "toolbar");
    const views = el("div", "segmented");
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", "View");
    for (const [key, label] of [["cards", "Cards"], ["list", "List"], ["compact", "Compact"]]) {
      const b = el("button", null, label);
      b.type = "button";
      b.dataset.view = key;
      b.addEventListener("click", () => {
        prefs.view = key;
        savePrefs(prefs);
        render();
      });
      views.append(b);
    }
    const sort = el("select");
    sort.setAttribute("aria-label", "Sort");
    for (const [key, label] of [["new", "Newest first"], ["old", "Oldest first"], ["az", "A to Z"]]) {
      const o = el("option", null, label);
      o.value = key;
      sort.append(o);
    }
    sort.value = prefs.sort;
    sort.addEventListener("change", () => {
      prefs.sort = sort.value;
      savePrefs(prefs);
      render();
    });
    const search = el("input", "search");
    search.type = "search";
    search.placeholder = "Search projects or classmates";
    search.setAttribute("aria-label", "Search projects or classmates");
    search.addEventListener("input", render);
    const folds = el("div", "folds");
    const expand = el("button", "link", "Expand all");
    const collapse = el("button", "link", "Collapse all");
    expand.type = collapse.type = "button";
    expand.addEventListener("click", () => {
      people.forEach((p) => open.add(p.login.toLowerCase()));
      render();
    });
    collapse.addEventListener("click", () => {
      open.clear();
      render();
    });
    folds.append(expand, collapse);
    toolbar.append(views, sort, search, folds);

    const body = el("div", "gallery-body");
    list.replaceChildren(el("h2", "section-title", "Classmates (" + people.length + ")"), toolbar, body,
      el("p", "muted updated", "List updated " + timeAgo(d.generatedAt) + ". It refreshes every 15 minutes."));

    function render() {
      const q = search.value.trim().toLowerCase();
      const match = (login, r) => !q || login.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q);
      const byDate = (a, b) => (prefs.sort === "old" ? a.localeCompare(b) : b.localeCompare(a));
      const byRepo = (a, b) => (prefs.sort === "az" ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : byDate(a.pushedAt, b.pushedAt));
      views.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === prefs.view)));
      body.replaceChildren();

      const shown = people
        .map((p) => ({ ...p, shown: p.repos.filter((r) => match(p.login, r)).sort(byRepo) }))
        .filter((p) => p.shown.length)
        .sort((a, b) => (prefs.sort === "az" ? a.login.localeCompare(b.login, undefined, { sensitivity: "base" })
          : byDate(a.newest, b.newest)));
      for (const p of shown) {
        const person = el("details", "person");
        person.dataset.login = p.login.toLowerCase();
        person.open = Boolean(q) || open.has(p.login.toLowerCase());
        const head = el("summary", "person-head");
        head.append(avatar(p.login), el("h3", null, p.login),
          el("span", "count", p.shown.length + (p.shown.length === 1 ? " project" : " projects") +
            " · updated " + new Date(p.newest).toLocaleDateString()));
        person.append(head, projectsView(p.login, p.shown, prefs.view));
        person.addEventListener("toggle", () => {
          if (q) return; // searching opens everyone; don't remember that
          if (person.open) open.add(p.login.toLowerCase());
          else open.delete(p.login.toLowerCase());
        });
        body.append(person);
      }
      if (!body.firstChild) body.append(el("p", "empty", "Nothing matches “" + search.value.trim() + "”."));
    }
    render();

    if (added) {
      const mine = body.querySelector('.person[data-login="' + CSS.escape(added.toLowerCase()) + '"]');
      const banner = el("div", "status ok", mine
        ? "You're on the site! Here are your projects. Everyone can see them now."
        : "You're on the site! Your projects will show here in a couple of minutes.");
      if (mine) {
        mine.before(banner);
        mine.classList.add("mine");
        banner.scrollIntoView({ block: "start" });
      } else {
        intro.prepend(banner);
      }
    }
  }

  function commentsOn(login, name) {
    return commentCounts[(login + "/" + name).toLowerCase()] || 0;
  }
  function talkLabel(n) {
    return "\u{1F4AC} " + n + (n === 1 ? " comment" : " comments");
  }

  function projectsView(login, repos, view) {
    if (view === "list") {
      const table = el("table", "list-view");
      const head = el("tr");
      for (const h of ["Project", "Language", "Updated"]) head.append(el("th", null, h));
      const thead = el("thead");
      thead.append(head);
      const tbody = el("tbody");
      for (const r of repos) {
        const row = el("tr");
        const name = el("td", "name");
        const a = el("a", null, r.name);
        a.href = "#/" + login + "/" + r.name;
        name.append(a);
        const talk = commentsOn(login, r.name);
        if (talk) name.append(el("span", "talk", " " + talkLabel(talk)));
        if (r.description) name.append(el("div", "muted", r.description));
        const lang = el("td");
        if (r.language) lang.append(el("span", "lang", r.language));
        row.append(name, lang, el("td", "muted", new Date(r.pushedAt).toLocaleDateString()));
        tbody.append(row);
      }
      table.append(thead, tbody);
      return table;
    }
    if (view === "compact") {
      const tags = el("div", "tags");
      for (const r of repos) {
        const talk = commentsOn(login, r.name);
        const a = el("a", "tag", r.name + (talk ? " \u{1F4AC}" + talk : ""));
        a.href = "#/" + login + "/" + r.name;
        a.title = (r.description ? r.description + " · " : "") + "Updated " + new Date(r.pushedAt).toLocaleDateString();
        tags.append(a);
      }
      return tags;
    }
    const cards = el("div", "cards");
    for (const r of repos) cards.append(projectCard(login, r));
    return cards;
  }

  function loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem("showcase-view")) || {}; } catch (e) { /* defaults */ }
    return {
      view: ["cards", "list", "compact"].includes(p.view) ? p.view : "cards",
      sort: ["new", "old", "az"].includes(p.sort) ? p.sort : "new"
    };
  }
  function savePrefs(p) {
    try { localStorage.setItem("showcase-view", JSON.stringify({ view: p.view, sort: p.sort })); } catch (e) { /* fine */ }
  }

  // Who shows right now: the sign-in server's list (cfg.api), plus what this browser just saved.
  // Repos come from the preloaded list, so this costs no GitHub calls for classmates we know.
  // Without the server, fall back to reading new "Add me" forms straight from GitHub.
  async function withLivePicks(d, skipCache) {
    let picks = null;
    if (cfg.api) {
      try {
        picks = (await getJson(cfg.api + "/api/picks", skipCache)).picks;
      } catch (err) {
        picks = null;
      }
    }
    if (!picks) return withFreshPicks(d, skipCache);
    const mine = readMine();
    if (mine && NAME.test(mine.login || "")) {
      const live = picks.find((p) => p.login.toLowerCase() === mine.login.toLowerCase());
      if (!live || live.at < mine.at) {
        picks = picks.filter((p) => p !== live);
        if (!mine.removed) picks.push({ login: mine.login, repos: mine.repos, notify: mine.notify, at: mine.at });
      }
    }
    const people = [];
    for (const p of picks) {
      const set = p.repos ? new Set(p.repos.map((n) => n.toLowerCase())) : null;
      const wanted = (r) => (set ? set.has(r.name.toLowerCase()) : r.language === "Java");
      const known = findPreloaded(d, p.login);
      if (known) {
        people.push({ login: known.login, picked: Boolean(set), notify: Boolean(p.notify), repos: known.repos.filter(wanted) });
        continue;
      }
      const built = d.people.find((x) => x.login.toLowerCase() === p.login.toLowerCase());
      try {
        const repos = await getJson("https://api.github.com/users/" + p.login + "/repos?type=owner&per_page=100&sort=pushed");
        people.push({
          login: p.login,
          picked: Boolean(set),
          repos: repos
            .filter((r) => !r.private && !r.fork && r.full_name.toLowerCase() !== SITE_REPO.toLowerCase())
            .map((r) => ({ name: r.name, description: r.description || "", language: r.language || "",
              pushedAt: r.pushed_at, files: null, main: null }))
            .filter(wanted)
        });
      } catch (err) {
        if (built) people.push(built);
      }
    }
    return { ...d, people };
  }

  // The class list is rebuilt a minute or two after each "Add me" form. Until then, read new forms straight
  // from GitHub so people show up right away. If GitHub is limiting us, the built list is still fine.
  async function withFreshPicks(d, skipCache) {
    let issues;
    try {
      issues = await getJson("https://api.github.com/repos/" + SITE_REPO +
        "/issues?labels=showcase&state=open&sort=updated&direction=desc&per_page=30", skipCache);
    } catch (err) {
      return d;
    }
    const fresh = new Map();
    for (const issue of issues) {
      if (issue.pull_request || issue.updated_at <= d.generatedAt) continue;
      const login = issueLogin(issue);
      if (!fresh.has(login.toLowerCase())) fresh.set(login.toLowerCase(), { login, picks: parsePicks(issue.body, login) });
    }
    if (fresh.size === 0) return d;
    const people = d.people.filter((p) => !fresh.has(p.login.toLowerCase()));
    const wanted = (f, r) => (f.picks === null ? r.language === "Java" : f.picks.has(r.name.toLowerCase()));
    for (const f of fresh.values()) {
      const known = findPreloaded(d, f.login);
      if (known) {
        people.push({ login: known.login, picked: f.picks !== null, repos: known.repos.filter((r) => wanted(f, r)) });
        continue;
      }
      try {
        const repos = await getJson("https://api.github.com/users/" + f.login + "/repos?type=owner&per_page=100&sort=pushed");
        people.push({
          login: f.login,
          picked: f.picks !== null,
          repos: repos
            .filter((r) => !r.private && !r.fork && r.full_name.toLowerCase() !== SITE_REPO.toLowerCase())
            .map((r) => ({ name: r.name, description: r.description || "", language: r.language || "",
              pushedAt: r.pushed_at, files: null, main: null }))
            .filter((r) => wanted(f, r))
        });
      } catch (err) {
        const old = d.people.find((p) => p.login.toLowerCase() === f.login.toLowerCase());
        if (old) people.push(old);
      }
    }
    return { ...d, people };
  }

  // Who an "Add me" issue is for: the person named in the sign-in server's marker line (only trusted on
  // issues the site owner's token opened), otherwise the issue's author. Same rule as build-data.mjs.
  function issueLogin(issue) {
    const m = String(issue.body || "").match(/<!--\s*login:\s*([A-Za-z0-9_.-]+)\s*-->/);
    if (m && issue.user.login.toLowerCase() === SITE_REPO.split("/")[0].toLowerCase()) return m[1];
    return issue.user.login;
  }

  // An "Add me" form body looks like "### Projects to show\n\nrepo-one\nrepo-two". Only the author's own
  // repos count; an empty form means all their public Java repos (null). Same rules as build-data.mjs.
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

  function projectCard(login, r, withOwner) {
    const a = el("a", "card");
    a.href = "#/" + login + "/" + r.name;
    if (withOwner) {
      const owner = el("div", "owner-line");
      owner.append(avatar(login), el("span", null, login));
      a.append(owner);
    }
    a.append(el("h4", null, r.name));
    if (r.description) a.append(el("p", null, r.description));
    const meta = el("div", "meta");
    if (r.language) meta.append(el("span", "lang", r.language));
    meta.append(el("span", null, "Updated " + new Date(r.pushedAt).toLocaleDateString()));
    const talk = commentsOn(login, r.name);
    if (talk) meta.append(el("span", "talk", talkLabel(talk)));
    a.append(meta);
    return a;
  }

  // ---------- compare ----------

  async function showCompare(key) {
    current = null;
    app.innerHTML = "";
    app.append(el("p", "muted pad", "Loading…"));
    let d;
    try {
      d = await loadData();
    } catch (err) {
      app.replaceChildren(backLink(), el("p", "error pad", errorText(err)));
      return;
    }
    const a = d.assignments.find((x) => x.key === key);
    if (!a) {
      app.replaceChildren(backLink(), el("p", "error pad", "That assignment isn't in the list anymore."));
      return;
    }
    document.title = "Compare " + a.label + " · " + (cfg.title || "Class Code Showcase");
    const versions = a.members.map((m) => findRepo(d, m.login, m.repo)).filter(Boolean);

    const head = el("section", "compare-head");
    head.append(backLink(), el("h1", null, "Compare: " + a.label),
      el("p", "muted", versions.length + " classmates did this one. Pick any two to read side by side."));
    const highlight = el("label", "check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = true;
    highlight.append(box, el("span", null, "Highlight what's different"));
    head.append(highlight);
    const shown = [null, null]; // { text, block } for each side
    const sync = () => {
      for (const side of shown) if (side) side.block.mark([], "only");
      if (!box.checked || !shown[0] || !shown[1]) return;
      const [onlyA, onlyB] = lineDiff(shown[0].text, shown[1].text);
      shown[0].block.mark(onlyA, "only");
      shown[1].block.mark(onlyB, "only");
    };
    box.addEventListener("change", sync);
    const panes = el("div", "compare");
    panes.append(
      comparePane(versions, 0, (side) => { shown[0] = side; sync(); }),
      comparePane(versions, Math.min(1, versions.length - 1), (side) => { shown[1] = side; sync(); })
    );
    app.replaceChildren(head, panes);
  }

  // Lines only in a, and lines only in b, as ranges, ignoring spacing. Longest common subsequence of lines.
  function lineDiff(a, b) {
    const norm = (t) => t.replace(/\n$/, "").split("\n").map((l) => l.trim().replace(/\s+/g, " "));
    const A = norm(a);
    const B = norm(b);
    if (A.length * B.length > 4000000) return [[], []];
    const W = B.length + 1;
    const len = new Uint16Array((A.length + 1) * W);
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) {
        len[i * W + j] = A[i] === B[j] ? len[(i + 1) * W + j + 1] + 1 : Math.max(len[(i + 1) * W + j], len[i * W + j + 1]);
      }
    }
    const onlyA = [];
    const onlyB = [];
    let i = 0;
    let j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) {
        i++;
        j++;
      } else if (j >= B.length || (i < A.length && len[(i + 1) * W + j] >= len[i * W + j + 1])) {
        if (A[i] !== "") onlyA.push(i + 1);
        i++;
      } else {
        if (B[j] !== "") onlyB.push(j + 1);
        j++;
      }
    }
    const ranges = (nums) => {
      const out = [];
      for (const n of nums) {
        const last = out[out.length - 1];
        if (last && last[1] === n - 1) last[1] = n;
        else out.push([n, n]);
      }
      return out;
    };
    return [ranges(onlyA), ranges(onlyB)];
  }

  function comparePane(versions, start, onShown) {
    const pane = el("div", "pane");
    const bar = el("div", "pane-bar");
    const who = el("select");
    who.setAttribute("aria-label", "Whose version");
    versions.forEach((v, i) => {
      const o = el("option", null, v.login + " · " + v.repo.name);
      o.value = String(i);
      who.append(o);
    });
    who.value = String(start);
    const file = el("select");
    file.setAttribute("aria-label", "File");
    const open = el("a", "btn small", "Open project");
    const run = el("button", "btn small", "\u25B6 Run");
    run.type = "button";
    bar.append(who, file, run, open);
    const body = el("div", "pane-body");
    const runBox = el("section", "run");
    runBox.hidden = true;
    pane.append(bar, runBox, body);
    run.addEventListener("click", () => {
      const v = versions[Number(who.value)];
      openRun(runBox, { owner: v.login, repo: v.repo.name, files: v.repo.files, main: v.repo.main });
    });

    function pickPerson() {
      const v = versions[Number(who.value)];
      open.href = "#/" + v.login + "/" + v.repo.name;
      if (!runBox.hidden && !busy) {
        runBox.hidden = true;
        runBox.replaceChildren();
      }
      file.replaceChildren();
      const files = [...v.repo.files].sort((x, y) => (y.endsWith(".java") - x.endsWith(".java")) || x.localeCompare(y));
      for (const f of files) {
        const o = el("option", null, f.split("/").pop());
        o.value = f;
        o.title = f;
        file.append(o);
      }
      if (v.repo.main) file.value = v.repo.main;
      showFile();
    }
    async function showFile() {
      const v = versions[Number(who.value)];
      const path = file.value;
      if (!path) {
        body.replaceChildren(el("p", "muted pad", "This repo has no files to show."));
        return;
      }
      body.replaceChildren(el("p", "muted pad", "Loading…"));
      try {
        const text = await getFile(v.login, v.repo.name, path);
        if (versions[Number(who.value)] === v && file.value === path) {
          const block = codeBlock(text, path);
          body.replaceChildren(block);
          if (onShown) onShown({ text, block });
        }
      } catch (err) {
        body.replaceChildren(el("p", "error pad", errorText(err)));
      }
    }
    who.addEventListener("change", pickPerson);
    file.addEventListener("change", showFile);
    pickPerson();
    return pane;
  }

  // ---------- add me ----------

  // Signed in = a session from the sign-in server (cfg.api), kept in this browser for 30 days.
  // It only says who you are; the server checks it before saving anything.
  function readSession() {
    try {
      const token = localStorage.getItem("showcase-session");
      const body = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
      return body.exp > Date.now() && NAME.test(body.login) ? { token, login: body.login } : null;
    } catch (e) {
      return null;
    }
  }
  function saveSession(token) {
    try {
      if (token) localStorage.setItem("showcase-session", token);
      else localStorage.removeItem("showcase-session");
    } catch (e) { /* fine */ }
  }

  // What this browser just saved, so the gallery shows it before the server's short cache catches up.
  function readMine() {
    try {
      const mine = JSON.parse(localStorage.getItem("showcase-mine"));
      return mine && Date.now() - Date.parse(mine.at) < 10 * 60 * 1000 ? mine : null;
    } catch (e) {
      return null;
    }
  }
  function saveMine(mine) {
    try { localStorage.setItem("showcase-mine", JSON.stringify(mine)); } catch (e) { /* fine */ }
  }

  function showAddMe(query) {
    current = null;
    document.title = "Add my projects · " + (cfg.title || "Class Code Showcase");
    app.innerHTML = "";
    const page = el("section", "add-me");
    page.append(backLink(), el("h1", null, "Add my projects"));
    app.append(page);

    const params = new URLSearchParams(query || "");
    if (params.get("session")) {
      saveSession(params.get("session"));
      history.replaceState(null, "", location.pathname + location.search + "#/add-me");
    }
    if (params.get("error")) {
      page.append(el("p", "error", params.get("error") === "cancelled"
        ? "Sign-in was cancelled. You can try again below."
        : "Sign-in didn't work. Please try again."));
    }
    if (!cfg.api) {
      formFlow(page);
      return;
    }
    const session = readSession();
    if (session) signedInFlow(page, session);
    else signInFlow(page);
  }

  function signInFlow(page) {
    page.append(el("p", "muted", "Sign in with GitHub, tick the projects you want to show, and click Save."));
    const go = el("a", "btn primary big", "Sign in with GitHub");
    go.href = cfg.api + "/api/login?return=" + encodeURIComponent(location.origin + location.pathname);
    const note = el("p", "muted small",
      "The site only learns your GitHub username. It can't see private repos or change anything in your account.");
    const other = el("button", "link", "Can't sign in? Use a GitHub form instead.");
    other.type = "button";
    const formBox = el("div");
    other.addEventListener("click", () => {
      other.remove();
      formFlow(formBox);
    });
    page.append(go, note, other, formBox);
  }

  async function signedInFlow(page, session) {
    const who = el("div", "who-bar");
    const out = el("button", "link", "Sign out");
    out.type = "button";
    out.addEventListener("click", () => {
      saveSession(null);
      route();
    });
    who.append(avatar(session.login), el("span", null, "Signed in as"), el("strong", null, session.login), out);
    const results = el("div", "picker");
    results.append(el("p", "muted", "Loading your projects…"));
    page.append(who, results);

    const loaded = await loadRepos(session.login);
    if (loaded.error) {
      results.replaceChildren(el("p", "error", loaded.error));
      return;
    }
    const send = async (method, body, status) => {
      status.className = "status";
      status.textContent = method === "DELETE" ? "Taking your projects down…" : "Saving…";
      try {
        const res = await fetch(cfg.api + "/api/picks", {
          method,
          headers: { Authorization: "Bearer " + session.token, "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined
        });
        const answer = await res.json().catch(() => ({}));
        if (res.status === 401) {
          saveSession(null);
          status.textContent = "Please sign in again.";
          setTimeout(route, 1200);
          return;
        }
        if (!res.ok) throw new Error(answer.error || "That didn't work.");
        if (method === "DELETE") {
          saveMine({ login: session.login, removed: true, at: new Date().toISOString() });
        } else {
          saveMine({ login: session.login, repos: answer.repos, notify: answer.notify, at: answer.at });
          justAdded = session.login;
        }
        location.hash = "#/";
      } catch (err) {
        status.className = "status bad";
        status.textContent = err.message + " Please try again.";
      }
    };
    renderPicker(results, session.login, loaded.repos, loaded.showing, {
      notify: loaded.notify,
      save: (names, status, notify) => send("PUT", { repos: names, notify }, status),
      remove: loaded.showing ? (status) => send("DELETE", null, status) : null
    });
  }

  // Their repos (preloaded when we know them) and what shows on the site today.
  async function loadRepos(login) {
    let d = null;
    try { d = await loadData(); } catch (err) { /* no list yet: ask GitHub */ }
    const known = d && findPreloaded(d, login);
    let repos;
    if (known) {
      repos = known.repos.map((r) => ({ name: r.name, language: r.language, pushed_at: r.pushedAt }));
    } else {
      try {
        repos = await getJson("https://api.github.com/users/" + login + "/repos?type=owner&per_page=100&sort=pushed");
      } catch (err) {
        return { error: err.message === "not-found" ? "No GitHub user named " + login + "." : errorText(err) };
      }
      repos = repos.filter((r) => !r.fork && r.full_name.toLowerCase() !== SITE_REPO.toLowerCase());
    }
    let showing = null;
    let notify = false;
    if (d) {
      const live = await withLivePicks(d, true);
      const hit = live.people.find((p) => p.login.toLowerCase() === login.toLowerCase());
      if (hit) showing = new Set(hit.repos.map((r) => r.name.toLowerCase()));
      if (hit) notify = Boolean(hit.notify);
    }
    return { repos, showing, notify };
  }

  // The backup way: type a username, then confirm with a GitHub form in a new tab.
  function formFlow(page) {
    page.append(el("p", "muted", "Type your GitHub username, tick the projects you want to show, then confirm on GitHub."));
    const form = el("form", "find-form");
    const input = el("input");
    input.type = "text";
    input.placeholder = "Your GitHub username";
    input.setAttribute("aria-label", "Your GitHub username");
    input.autocomplete = "off";
    input.required = true;
    try { input.value = localStorage.getItem("showcase-username") || ""; } catch (e) { /* fine */ }
    const names = el("datalist");
    names.id = "classmate-names";
    input.setAttribute("list", names.id);
    loadData().then((d) => {
      for (const p of d.preloaded || []) {
        const o = el("option");
        o.value = p.login;
        names.append(o);
      }
    }).catch(() => { /* no suggestions */ });
    const find = el("button", null, "Find my projects");
    find.type = "submit";
    form.append(input, names, find);
    const results = el("div", "picker");
    page.append(form, results);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const login = input.value.trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//i, "").replace(/\/.*$/, "");
      if (!NAME.test(login)) {
        results.replaceChildren(el("p", "error", "That doesn't look like a GitHub username."));
        return;
      }
      try { localStorage.setItem("showcase-username", login); } catch (err) { /* fine */ }
      results.replaceChildren(el("p", "muted", "Looking up " + login + "…"));
      const loaded = await loadRepos(login);
      if (loaded.error) results.replaceChildren(el("p", "error", loaded.error));
      else renderPicker(results, login, loaded.repos, loaded.showing, null);
    });
    if (input.value) form.requestSubmit();
  }

  // actions: { save(names, status), remove(status) } when signed in; null for the GitHub-form way.
  function renderPicker(box, login, repos, showing, actions) {
    if (repos.length === 0) {
      box.replaceChildren(el("p", "empty", login + " has no public repos yet. Push a project from IntelliJ, then come back."));
      return;
    }
    const list = el("div", "pick-list");
    for (const r of repos) {
      const label = el("label", "pick");
      const check = el("input");
      check.type = "checkbox";
      check.value = r.name;
      check.checked = showing ? showing.has(r.name.toLowerCase()) : r.language === "Java";
      const text = el("div");
      text.append(el("strong", null, r.name));
      const meta = el("div", "meta");
      if (r.language) meta.append(el("span", "lang", r.language));
      meta.append(el("span", null, "Updated " + new Date(r.pushed_at).toLocaleDateString()));
      text.append(meta);
      label.append(check, text);
      list.append(label);
    }
    const tools = el("div", "pick-tools");
    const count = el("span", "muted");
    const all = el("button", "link", "Select all");
    const none = el("button", "link", "Select none");
    all.type = none.type = "button";
    all.onclick = () => { list.querySelectorAll("input").forEach((c) => { c.checked = true; }); update(); };
    none.onclick = () => { list.querySelectorAll("input").forEach((c) => { c.checked = false; }); update(); };
    tools.append(count, all, none);
    const status = el("div", "status");
    const checked = () => [...list.querySelectorAll("input:checked")].map((c) => c.value);

    let go;
    let after;
    let emails = null;
    if (actions) {
      emails = el("label", "check emails");
      const optIn = el("input");
      optIn.type = "checkbox";
      optIn.checked = Boolean(actions.notify);
      const words = el("span");
      words.append(el("strong", null, "Email me when someone comments on my projects."),
        el("span", "muted", " Off unless you tick it. GitHub sends these to the email on your GitHub account; this site never sees it."));
      emails.append(optIn, words);
      go = el("button", "btn primary big", showing ? "Save changes" : "Save and show my projects");
      go.type = "button";
      go.addEventListener("click", () => {
        if (checked().length) actions.save(checked(), status, optIn.checked);
      });
      after = el("div", "after-row");
      after.append(el("span", "muted", "You can come back and change this any time."));
      if (actions.remove) {
        const remove = el("button", "link danger", "Take all my projects off the site");
        remove.type = "button";
        remove.addEventListener("click", () => actions.remove(status));
        after.append(remove);
      }
    } else {
      go = el("a", "btn primary", "Continue to GitHub");
      go.target = "_blank";
      go.rel = "noopener";
      go.addEventListener("click", (e) => {
        if (go.classList.contains("disabled")) {
          e.preventDefault();
          return;
        }
        waitForForm(status, login, new Date(Date.now() - 60000).toISOString());
      });
      after = el("ol", "after");
      const s1 = el("li");
      s1.append("On GitHub, click ", el("strong", null, "Create"), ".");
      after.append(s1, el("li", null, "Want emails about comments on your projects? Tick \"Email me\" on that form. It's off unless you do."),
        el("li", null, "Come back to this tab. It takes you to the gallery with your projects."),
        el("li", null, "Want to change them later? Do this again. Your newest one counts."));
    }

    function update() {
      const names = checked();
      count.textContent = names.length + " of " + repos.length + " selected";
      if (!actions) {
        go.href = "https://github.com/" + SITE_REPO + "/issues/new?template=add-me.yml&title=" +
          encodeURIComponent("Add me: " + login) + "&repos=" + encodeURIComponent(names.join("\n"));
      }
      go.classList.toggle("disabled", names.length === 0);
    }
    list.addEventListener("change", update);
    update();
    box.replaceChildren(el("h2", null, "Pick your projects"), tools, list, ...(emails ? [emails] : []), go, status, after);
  }

  // Check GitHub for their new form when they come back to this tab (and on a button), not on a timer,
  // so a whole class doing this at once stays well under GitHub's limit.
  function waitForForm(box, login, since) {
    const again = el("button", "link", "Check again");
    again.type = "button";
    const msg = el("span", null, "GitHub opened in a new tab. Click Create there, then come back to this tab. ");
    box.className = "status waiting";
    box.replaceChildren(msg, again);
    let done = false;
    async function check() {
      if (done) return;
      msg.textContent = "Checking… ";
      let issues = [];
      try {
        issues = await getJson("https://api.github.com/repos/" + SITE_REPO +
          "/issues?labels=showcase&state=open&creator=" + encodeURIComponent(login) + "&sort=created&direction=desc&per_page=1", true);
      } catch (err) {
        msg.textContent = errorText(err) + " ";
        return;
      }
      if (issues.length && issues[0].created_at >= since) {
        done = true;
        window.removeEventListener("focus", check);
        justAdded = login;
        location.hash = "#/";
      } else {
        msg.textContent = "Not yet. Click Create on GitHub, then come back to this tab. ";
      }
    }
    again.addEventListener("click", check);
    window.addEventListener("focus", check);
    window.addEventListener("hashchange", () => { done = true; window.removeEventListener("focus", check); }, { once: true });
  }

  // ---------- project viewer ----------

  async function showProject(owner, repo, path, query) {
    document.title = repo + " · " + (cfg.title || "Class Code Showcase");
    const same = current && current.owner === owner && current.repo === repo;
    if (!same) {
      current = null;
      app.innerHTML = "";
      app.append(el("p", "muted pad", "Loading " + owner + "/" + repo + "…"));
      let files;
      let main = null;
      const hit = await loadData().then((d) => findRepo(d, owner, repo)).catch(() => null);
      if (hit && hit.repo.files) {
        files = hit.repo.files;
        main = hit.repo.main;
      } else {
        try {
          const tree = await getJson("https://api.github.com/repos/" + owner + "/" + repo + "/git/trees/HEAD?recursive=1");
          files = tree.tree
            .filter((t) => t.type === "blob" && !BINARY.test(t.path) && t.size < 400000)
            .filter((t) => !t.path.split("/").some((part) => HIDDEN_DIRS.has(part)))
            .map((t) => t.path);
        } catch (err) {
          app.replaceChildren(el("p", "error pad", errorText(err)), backLink());
          return;
        }
      }
      current = { owner, repo, files, main };
      renderShell(owner, repo, files);
    }
    if (!path) path = current.main || await pickStartFile(owner, repo, current.files);
    openFile(path, lineRange(query));
  }

  // "L=12" or "L=12-15" from a route's query.
  function lineRange(query) {
    const m = new URLSearchParams(query || "").get("L");
    const nums = String(m || "").match(/^(\d+)(?:-(\d+))?$/);
    if (!nums) return null;
    const a = Number(nums[1]);
    const b = Number(nums[2] || nums[1]);
    return a > 0 && b > 0 ? [Math.min(a, b), Math.max(a, b)] : null;
  }

  function renderShell(owner, repo, files) {
    app.innerHTML = "";
    const bar = el("div", "project-bar");
    const who = el("div", "who");
    const names = el("div");
    names.append(el("div", "owner", owner), el("h1", null, repo));
    who.append(avatar(owner), names);
    const links = el("div", "links");
    const runBtn = el("button", "run-open", "▶ Run");
    runBtn.type = "button";
    const historyBtn = el("button", "btn", "\u{1F552} How they built it");
    historyBtn.type = "button";
    links.append(
      runBtn,
      historyBtn,
      extLink("https://github.com/" + owner + "/" + repo, "View on GitHub"),
      extLink("https://github.dev/" + owner + "/" + repo, "Open in web editor")
    );
    bar.append(backLink(), who, links);
    const runBox = el("section", "run");
    runBox.hidden = true;
    runBtn.addEventListener("click", () => openRun(runBox));
    const historyBox = el("section", "history");
    historyBox.hidden = true;
    historyBtn.addEventListener("click", () => openHistory(historyBox, owner, repo));

    const layout = el("div", "layout");
    const side = el("nav", "files");
    side.setAttribute("aria-label", "Files");
    side.append(el("div", "files-title", files.length + " files"));
    side.append(renderTree(buildTree(files)));
    const viewer = el("section", "viewer");
    viewer.id = "viewer";
    layout.append(side, viewer);

    const comments = el("section", "comments");
    comments.id = "comments";
    app.append(bar, runBox, historyBox, layout, comments);
    renderComments(owner, repo, comments);
  }

  // Open the file with main() first, for repos the class list doesn't cover.
  async function pickStartFile(owner, repo, files) {
    const java = files.filter((f) => f.endsWith(".java")).slice(0, 15);
    const texts = await Promise.all(java.map((f) => getFile(owner, repo, f).catch(() => "")));
    const withMain = java.find((f, i) => /static\s+void\s+main\s*\(/.test(texts[i]));
    return withMain || java[0] || files.find((f) => /readme/i.test(f)) || files[0] || "";
  }

  async function openFile(path, lines) {
    const viewer = document.getElementById("viewer");
    if (!viewer) return;
    document.querySelectorAll(".files a.active").forEach((a) => a.classList.remove("active"));
    const link = document.querySelector('.files a[data-path="' + CSS.escape(path) + '"]');
    if (link) {
      link.classList.add("active");
      for (let d = link.closest("details"); d; d = d.parentElement.closest("details")) d.open = true;
    }
    if (!path) {
      viewer.replaceChildren(el("p", "muted pad", "This repo has no files to show."));
      return;
    }
    const head = el("div", "file-head");
    head.append(el("span", null, path));
    viewer.replaceChildren(head, el("p", "muted pad", "Loading…"));
    let text;
    try {
      text = await getFile(current.owner, current.repo, path);
    } catch (err) {
      viewer.replaceChildren(head, el("p", "error pad", errorText(err)));
      return;
    }
    const proj = current;

    // Click a line number for a link to that line; shift-click for a range.
    let picked = lines;
    const block = codeBlock(text, path, {
      onLine: (n, shift) => {
        picked = shift && picked ? [Math.min(picked[0], n), Math.max(picked[1], n)] : [n, n];
        block.mark([picked], "picked");
        const range = picked[0] === picked[1] ? String(picked[0]) : picked[0] + "-" + picked[1];
        const hash = "#/" + proj.owner + "/" + proj.repo + "/" + path.split("/").map(encodeURIComponent).join("/") + "?L=" + range;
        history.replaceState(null, "", location.pathname + location.search + hash);
        const url = location.href;
        const done = () => toast("Link to line " + range + " copied. Paste it in a comment.");
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => toast("Link to line " + range + " is in the address bar."));
        else toast("Link to line " + range + " is in the address bar.");
      }
    });
    head.append(el("span", "muted hint", "Click a line number to link to it"));

    if (/\.(md|markdown)$/i.test(path) && window.marked && window.DOMPurify) {
      const doc = renderMarkdown(text, proj, path);
      const toggle = el("button", "link", "Show source");
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        const showingDoc = doc.isConnected;
        (showingDoc ? doc : block).replaceWith(showingDoc ? block : doc);
        toggle.textContent = showingDoc ? "Show formatted" : "Show source";
      });
      head.lastChild.replaceWith(toggle);
      viewer.replaceChildren(head, doc);
      return;
    }
    viewer.replaceChildren(head, block);
    if (lines) {
      block.mark([lines], "picked");
      const first = block.querySelector(".band.picked");
      if (first) first.scrollIntoView({ block: "center" });
    }
  }

  // A README as a formatted page. Links to files in the repo open here; images load from GitHub.
  function renderMarkdown(text, proj, path) {
    const doc = el("article", "markdown");
    doc.innerHTML = DOMPurify.sanitize(marked.parse(text));
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const rel = (url) => !/^([a-z]+:|#|\/\/)/i.test(url);
    const clean = (p) => {
      const out = [];
      for (const part of (dir + p).split("/")) {
        if (part === "..") out.pop();
        else if (part && part !== ".") out.push(part);
      }
      return out.join("/");
    };
    doc.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (rel(src)) img.src = "https://raw.githubusercontent.com/" + proj.owner + "/" + proj.repo + "/HEAD/" + clean(src);
    });
    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (href.startsWith("#")) {
        a.removeAttribute("href");
      } else if (rel(href)) {
        a.href = "#/" + proj.owner + "/" + proj.repo + "/" + clean(href.split("#")[0]);
      } else {
        a.target = "_blank";
        a.rel = "noopener";
      }
    });
    return doc;
  }

  // opts.onLine(n, shift): the visitor clicked line number n. The result has mark(ranges, kind) to tint lines.
  function codeBlock(text, path, opts) {
    const ext = (path.split(".").pop() || "").toLowerCase();
    const lang = LANGS[ext] || "plaintext";
    const lines = text.replace(/\n$/, "").split("\n");
    const wrap = el("div", "code");
    const gutter = el("pre", "gutter");
    gutter.setAttribute("aria-hidden", "true");
    if (opts && opts.onLine) {
      gutter.classList.add("linked");
      for (let i = 1; i <= lines.length; i++) {
        const n = el("span", null, String(i));
        n.dataset.n = i;
        gutter.append(n);
      }
      gutter.addEventListener("click", (e) => {
        const n = e.target.dataset && Number(e.target.dataset.n);
        if (n) opts.onLine(n, e.shiftKey);
      });
    } else {
      gutter.textContent = lines.map((_, i) => i + 1).join("\n");
    }
    const pre = el("pre", "source");
    const code = el("code", "hljs");
    if (window.hljs && hljs.getLanguage(lang)) {
      code.innerHTML = hljs.highlight(lines.join("\n"), { language: lang, ignoreIllegals: true }).value;
    } else {
      code.textContent = lines.join("\n");
    }
    pre.append(code);
    wrap.append(gutter, pre);
    wrap.lineCount = lines.length;
    // Tint whole lines: ranges like [[3, 5], [9, 9]] (1-based). Each kind replaces its own earlier marks.
    wrap.mark = (ranges, kind) => {
      wrap.querySelectorAll(".band." + kind).forEach((b) => b.remove());
      for (const [a, b] of ranges) {
        const band = el("div", "band " + kind);
        band.style.setProperty("--n", a - 1);
        band.style.setProperty("--k", b - a + 1);
        wrap.append(band);
      }
    };
    return wrap;
  }

  function toast(text) {
    let t = document.getElementById("toast");
    if (!t) {
      t = el("div", "toast");
      t.id = "toast";
      t.setAttribute("role", "status");
      document.body.append(t);
    }
    t.textContent = text;
    t.classList.add("on");
    clearTimeout(t.timer);
    t.timer = setTimeout(() => t.classList.remove("on"), 2600);
  }

  // ---------- how they built it (commit history) ----------

  async function openHistory(box, owner, repo) {
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (box.dataset.loaded) return;
    if (!cfg.api) {
      box.replaceChildren(el("p", "muted pad", "History isn't available on this site."));
      return;
    }
    box.replaceChildren(el("p", "muted pad", "Loading the history…"));
    let commits;
    try {
      const res = await fetch(cfg.api + "/api/commits?repo=" + encodeURIComponent(owner + "/" + repo));
      const body = await res.json();
      if (!res.ok) throw new Error(res.status === 404 ? "History is only shown for projects on the showcase." : body.error);
      commits = body.commits.reverse(); // oldest first: the story in order
    } catch (err) {
      box.replaceChildren(el("p", "error pad", err.message || "Couldn't load the history."));
      return;
    }
    box.dataset.loaded = "1";
    if (!commits.length) {
      box.replaceChildren(el("p", "muted pad", "No commits yet."));
      return;
    }
    const head = el("div", "history-head");
    head.append(el("h2", null, "How they built it"),
      el("span", "muted", commits.length + (commits.length === 1 ? " step" : " steps") + ", oldest first"));
    const steps = el("ol", "steps");
    const detail = el("div", "step-detail");
    const items = commits.map((c, i) => {
      const li = el("li");
      const b = el("button", "step");
      b.type = "button";
      b.append(el("span", "step-n", "Step " + (i + 1)), el("span", "step-msg", c.message.split("\n")[0]),
        el("span", "muted step-date", new Date(c.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })));
      b.addEventListener("click", () => show(i));
      li.append(b);
      steps.append(li);
      return b;
    });
    const layout = el("div", "history-layout");
    layout.append(steps, detail);
    box.replaceChildren(head, layout);

    async function show(i) {
      items.forEach((b, j) => b.classList.toggle("on", j === i));
      const c = commits[i];
      const nav = el("div", "step-nav");
      const prev = el("button", "btn small", "← Previous step");
      const next = el("button", "btn small", "Next step →");
      prev.type = next.type = "button";
      prev.disabled = i === 0;
      next.disabled = i === commits.length - 1;
      prev.addEventListener("click", () => show(i - 1));
      next.addEventListener("click", () => show(i + 1));
      nav.append(prev, el("strong", null, "Step " + (i + 1) + " of " + commits.length), next);
      detail.replaceChildren(nav, el("p", "muted pad", "Loading what changed…"));
      let full;
      try {
        const res = await fetch(cfg.api + "/api/commit?repo=" + encodeURIComponent(owner + "/" + repo) + "&sha=" + c.sha);
        full = await res.json();
        if (!res.ok) throw new Error(full.error);
      } catch (err) {
        detail.replaceChildren(nav, el("p", "error pad", "Couldn't load this step."));
        return;
      }
      if (!items[i].classList.contains("on")) return; // they clicked another step meanwhile
      const msg = el("div", "commit-msg", full.message);
      const files = el("div", "changes");
      const visible = full.files.filter((f) => !f.filename.split("/").some((p) => HIDDEN_DIRS.has(p)))
        .sort((a, b) => /\.java$/i.test(b.filename) - /\.java$/i.test(a.filename));
      if (!visible.length) files.append(el("p", "muted pad", "No code files changed in this step."));
      for (const f of visible) files.append(renderChange(f));
      const hidden = full.files.length - visible.length;
      if (hidden) files.append(el("p", "muted small", hidden + " IntelliJ settings file" + (hidden === 1 ? "" : "s") + " also changed (hidden)."));
      detail.replaceChildren(nav, msg, files);
    }
    show(0);
  }

  function renderChange(f) {
    const box = el("details", "change");
    box.open = /\.java$/i.test(f.filename); // Java first and open; .gitignore, pom.xml and the like start closed
    const head = el("summary");
    const words = { added: "new file", removed: "deleted", renamed: "renamed", modified: "changed" };
    head.append(el("strong", null, f.filename), el("span", "muted", " " + (words[f.status] || f.status)),
      el("span", "plus", " +" + f.additions), el("span", "minus", " −" + f.deletions));
    box.append(head);
    if (!f.patch) {
      box.append(el("p", "muted pad", f.additions + f.deletions ? "Too big to show here." : "No line changes."));
      return box;
    }
    const pre = el("pre", "patch");
    for (const line of f.patch.split("\n")) {
      if (line.startsWith("\\")) continue; // "\ No newline at end of file"
      const kind = line.startsWith("@@") ? "hunk" : line[0] === "+" ? "add" : line[0] === "-" ? "del" : "same";
      pre.append(el("span", kind, (kind === "hunk" ? "⋯ " + (line.match(/@@[^@]*@@\s*(.*)/) || [, ""])[1] : line) + "\n"));
    }
    box.append(pre);
    return box;
  }

  // ---------- run (Java in the browser, with CheerpJ) ----------
  // The first Run loads CheerpJ (a Java 17 runtime for browsers) from its CDN, and javac17.jar from run/.
  // run/RunWithInput.java compiles the files and runs main. Its native methods are the functions in
  // `natives`: output comes to the terminal box, and System.in asks the box for one line at a time.

  const CHEERPJ = "https://cjrtnc.leaningtech.com/4.3/loader.js";
  const RUN_DIR = "/app" + new URL("run/", location.href).pathname; // CheerpJ sees this site under /app/
  const RUN_CP = RUN_DIR + "runwithinput.jar:" + RUN_DIR + "javac17.jar";
  const WORK = "/files/showcase"; // CheerpJ's saved folder; RunWithInput clears it on every compile
  const MAX_OUTPUT = 200000;
  let java = null; // promise: CheerpJ is ready
  let term = null; // the terminal of the program that's running (or ran last)
  let busy = false;

  const natives = {
    async Java_RunWithInput_readLine() { return term ? term.ask() : null; },
    async Java_RunWithInput_write(lib, text, err) { if (term) term.print(String(text), err === 1); },
    async Java_RunWithInput_done(lib, code) { if (term) term.code = code; }
  };

  function loadJava() {
    if (!java) {
      java = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = CHEERPJ;
        s.onload = resolve;
        s.onerror = () => reject(new Error("Couldn't load Java (CheerpJ). Check your internet connection and try again."));
        document.head.append(s);
      }).then(() => cheerpjInit({ version: 17, status: "none", natives }));
      java.catch(() => { java = null; });
    }
    return java;
  }

  // The files to compile: everything under src/main/java, or (plain IntelliJ projects) every .java outside tests.
  function runFiles(files) {
    const all = files.filter((f) => f.endsWith(".java"));
    const maven = all.filter((f) => f.startsWith("src/main/java/"));
    return maven.length ? maven : all.filter((f) => !/(^|\/)test\//.test(f));
  }

  // Classes with a main method, named from the file and its package line.
  function findMains(paths, texts) {
    const mains = [];
    paths.forEach((p, i) => {
      const code = texts[i].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      if (!/\bstatic\s+(final\s+)?void\s+main\s*\(/.test(code)) return;
      const pkg = code.match(/^\s*package\s+([\w.]+)\s*;/m);
      const cls = p.split("/").pop().replace(/\.java$/, "");
      mains.push({ path: p, name: (pkg ? pkg[1] + "." : "") + cls });
    });
    return mains;
  }

  async function openRun(box, project) {
    if (!box.hidden) {
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    box.hidden = false;
    const proj = project || current;
    const paths = runFiles(proj.files);
    box.replaceChildren(el("p", "muted pad", "Getting the Java files…"));
    let texts;
    try {
      texts = await Promise.all(paths.map((p) => getFile(proj.owner, proj.repo, p)));
    } catch (err) {
      box.replaceChildren(el("p", "error pad", errorText(err)));
      box.hidden = true;
      return;
    }
    if (!box.isConnected || box.hidden) return;
    const mains = findMains(paths, texts);
    if (!paths.length || !mains.length) {
      box.replaceChildren(el("p", "muted pad", paths.length
        ? "No file here has a main method, so there's nothing to run."
        : "This project has no Java files to run."));
      return;
    }

    const bar = el("div", "run-bar");
    const pick = el("select");
    pick.setAttribute("aria-label", "Class to run");
    for (const m of mains) {
      const o = el("option", null, m.name);
      o.value = m.name;
      o.title = m.path;
      pick.append(o);
    }
    const open = document.querySelector(".files a.active");
    const start = mains.find((m) => open && m.path === open.dataset.path) || mains.find((m) => m.path === proj.main) || mains[0];
    pick.value = start.name;
    pick.hidden = mains.length === 1;
    const go = el("button", null, "▶ Run");
    go.type = "button";
    const stop = el("button", "btn", "■ Stop");
    stop.type = "button";
    stop.title = "Stops the program by reloading the page";
    const status = el("span", "run-status muted");
    status.setAttribute("aria-live", "polite");
    bar.append(pick, go, stop, status);

    const screen = el("pre", "term");
    screen.setAttribute("role", "log");
    screen.tabIndex = 0;
    const form = el("form", "term-input");
    const prompt = el("span", "term-prompt", "›");
    const input = el("input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Input for the program");
    const send = el("button", null, "Send");
    send.type = "submit";
    const eof = el("button", "btn small", "Send end of input");
    eof.type = "button";
    eof.title = "For programs that read until the input runs out";
    form.append(prompt, input, send, eof);
    const credit = el("p", "run-credit muted");
    const cj = extLink("https://cheerpj.com/", "CheerpJ");
    cj.className = "";
    credit.append("Runs in your browser. Run button powered by ", cj, ". The first run downloads about 15 MB.");
    box.replaceChildren(bar, screen, form, credit);

    const t = { screen, form, input, status, count: 0, strip: WORK + "/src/", code: null, waiting: null, color: "" };
    t.print = (text, err) => {
      if (t.count > MAX_OUTPUT) return;
      text = text.split(t.strip).join("");
      t.count += text.length;
      if (t.count > MAX_OUTPUT) text += "\n… more output was cut off here …\n";
      const near = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 40;
      // Color codes like "\u001b[32m" (green) work as in IntelliJ's Run window, and "\u001b[2J" clears.
      text.split(/(\u001b\[[\d;]*[A-Za-z])/).forEach((part, i) => {
        if (i % 2) {
          const codes = part.slice(2, -1).split(";").map(Number);
          if (part.endsWith("J")) screen.replaceChildren();
          if (!part.endsWith("m")) return;
          for (const c of codes) {
            if (c === 0) t.color = "";
            else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) t.color = " a" + c;
            else if (c === 39) t.color = "";
          }
          return;
        }
        if (!part) return;
        const kind = (err ? "err" : "out") + t.color;
        const last = screen.lastChild;
        if (last && last.className === kind) last.textContent += part;
        else screen.append(el("span", kind, part));
      });
      if (near) screen.scrollTop = screen.scrollHeight;
    };
    t.ask = () => new Promise((resolve) => {
      t.waiting = resolve;
      setInputOn(t, true);
      input.focus({ preventScroll: true });
    });
    t.answer = (line) => {
      const resolve = t.waiting;
      if (!resolve) return;
      t.waiting = null;
      if (line === null) screen.append(el("span", "muted", "(end of input)\n"));
      else screen.append(el("span", "typed", line + "\n"));
      screen.scrollTop = screen.scrollHeight;
      setInputOn(t, false);
      resolve(line);
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const line = input.value;
      input.value = "";
      t.answer(line);
    });
    eof.addEventListener("click", () => t.answer(null));
    stop.addEventListener("click", () => { if (busy) location.reload(); });
    go.addEventListener("click", () => runProgram(t, proj, paths, texts, pick.value, go, stop));
    setInputOn(t, false);
    stop.disabled = true;
    form.hidden = true;
    if (busy) {
      status.textContent = "Another program is still running. Stop it first.";
      stop.disabled = false;
    } else if (mains.length === 1) {
      runProgram(t, proj, paths, texts, pick.value, go, stop);
    } else {
      status.textContent = "This project has " + mains.length + " classes with main. Pick one, then click Run.";
    }
  }

  function setInputOn(t, on) {
    t.input.disabled = !on;
    t.form.querySelectorAll("button").forEach((b) => { b.disabled = !on; });
    t.form.classList.toggle("asking", on);
    t.input.placeholder = on ? "Type here, then press Enter" : "The program isn't asking for input";
  }

  async function runProgram(t, proj, paths, texts, mainClass, go, stop) {
    if (busy) return;
    busy = true;
    term = t;
    go.disabled = true;
    stop.disabled = false;
    t.screen.replaceChildren();
    t.count = 0;
    t.form.hidden = false;
    const started = performance.now();
    const secs = () => ((performance.now() - started) / 1000).toFixed(1) + " s";
    const call = async (args) => {
      t.code = null;
      const r = await cheerpjRunMain("RunWithInput", RUN_CP, ...args);
      return t.code != null ? t.code : r;
    };
    try {
      t.status.textContent = java ? "Starting…" : "Loading Java. The first run takes 10 seconds or more…";
      await loadJava();
      t.status.textContent = "Compiling " + paths.length + (paths.length === 1 ? " file…" : " files…");
      const enc = new TextEncoder();
      texts.forEach((text, i) => cheerpOSAddStringFile("/str/src" + i + ".java", enc.encode(text)));
      const compiled = await call(["compile", WORK, ...paths]);
      if (compiled !== 0) {
        t.status.textContent = "It didn't compile. The errors are above.";
        return;
      }
      t.status.textContent = "Running " + mainClass + "…";
      const code = await call(["run", WORK, mainClass]);
      t.status.textContent = (code === 0 ? "Finished" : "Stopped with exit code " + code) + " (" + secs() + ").";
    } catch (err) {
      t.print("\n" + (err && err.message ? err.message : String(err)) + "\n", true);
      t.status.textContent = "Something went wrong.";
    } finally {
      busy = false;
      go.disabled = false;
      stop.disabled = true;
      setInputOn(t, false);
      if (t.waiting) t.answer(null);
    }
  }

  // ---------- file tree ----------

  function buildTree(files) {
    const root = { dirs: new Map(), files: [] };
    for (const f of files) {
      const parts = f.split("/");
      let node = root;
      for (const p of parts.slice(0, -1)) {
        if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [] });
        node = node.dirs.get(p);
      }
      node.files.push(f);
    }
    return root;
  }

  function renderTree(node) {
    const ul = el("ul");
    const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (let [name, child] of dirs) {
      // Fold chains like src/main/java/com/pluralsight into one row.
      while (child.files.length === 0 && child.dirs.size === 1) {
        const [next, grand] = child.dirs.entries().next().value;
        name += "/" + next;
        child = grand;
      }
      const li = el("li");
      const d = el("details");
      d.open = true;
      d.append(el("summary", null, name), renderTree(child));
      li.append(d);
      ul.append(li);
    }
    for (const f of [...node.files].sort()) {
      const li = el("li");
      const a = el("a", f.endsWith(".java") ? "java" : null, f.split("/").pop());
      a.href = "#/" + current.owner + "/" + current.repo + "/" + f.split("/").map(encodeURIComponent).join("/");
      a.dataset.path = f;
      li.append(a);
      ul.append(li);
    }
    return ul;
  }

  // ---------- comments (giscus) ----------

  function renderComments(owner, repo, box) {
    box.append(el("h2", null, "Comments"));
    const g = cfg.giscus || {};
    if (!g.repoId || !g.categoryId) {
      box.append(el("p", "muted", "Comments aren't turned on yet."));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://giscus.app/client.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    const attrs = {
      "data-repo": g.repo, "data-repo-id": g.repoId, "data-category": g.category, "data-category-id": g.categoryId,
      "data-mapping": "specific", "data-term": owner + "/" + repo, "data-strict": "1",
      "data-reactions-enabled": "1", "data-input-position": "top", "data-theme": "preferred_color_scheme",
      "data-lang": "en", "data-loading": "lazy"
    };
    for (const k in attrs) s.setAttribute(k, attrs[k]);
    box.append(s);
  }

  // ---------- helpers ----------

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function avatar(login) {
    const img = el("img", "avatar");
    img.src = "https://github.com/" + encodeURIComponent(login) + ".png?size=64";
    img.alt = "";
    return img;
  }

  function extLink(href, text) {
    const a = el("a", "btn", text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  function backLink() {
    const a = el("a", "back", "← All projects");
    a.href = "#/";
    return a;
  }

  function timeAgo(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + (mins === 1 ? " minute ago" : " minutes ago");
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    return new Date(iso).toLocaleDateString();
  }
})();
