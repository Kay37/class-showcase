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
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length === 1 && parts[0] === "add-me") {
      showAddMe();
    } else if (parts.length === 2 && parts[0] === "~compare") {
      showCompare(parts[1]);
    } else if (parts.length >= 2 && NAME.test(parts[0]) && NAME.test(parts[1])) {
      showProject(parts[0], parts[1], parts.slice(2).join("/"));
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
      d = await withFreshPicks(await loadData());
    } catch (err) {
      list.replaceChildren(el("p", "error", errorText(err)));
      return;
    }

    const shared = d.assignments.filter((a) => a.members.length >= 3);
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
      .map((p) => ({ ...p, newest: p.repos.reduce((m, r) => (r.pushedAt > m ? r.pushedAt : m), "") }))
      .sort((a, b) => b.newest.localeCompare(a.newest));
    if (people.length === 0) {
      list.replaceChildren(el("p", "empty", "Nobody has added projects yet. Be the first: click Add my projects."));
      return;
    }
    list.replaceChildren(el("h2", "section-title", "Classmates"));
    for (const p of people) {
      const person = el("div", "person");
      const head = el("div", "person-head");
      head.append(avatar(p.login), el("h3", null, p.login),
        el("span", "count", p.repos.length + (p.repos.length === 1 ? " project" : " projects")));
      const cards = el("div", "cards");
      const repos = [...p.repos].sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
      for (const r of repos) cards.append(projectCard(p.login, r));
      person.append(head, cards);
      list.append(person);
    }
    list.append(el("p", "muted updated", "List updated " + timeAgo(d.generatedAt) + ". It refreshes every 15 minutes."));
  }

  // The class list is rebuilt a minute or two after each "Add me" form. Until then, read new forms straight
  // from GitHub so people show up right away. If GitHub is limiting us, the built list is still fine.
  async function withFreshPicks(d) {
    let issues;
    try {
      issues = await getJson("https://api.github.com/repos/" + SITE_REPO +
        "/issues?labels=showcase&state=open&sort=updated&direction=desc&per_page=30");
    } catch (err) {
      return d;
    }
    const fresh = new Map();
    for (const issue of issues) {
      if (issue.pull_request || issue.updated_at <= d.generatedAt) continue;
      const key = issue.user.login.toLowerCase();
      if (!fresh.has(key)) fresh.set(key, { login: issue.user.login, picks: parsePicks(issue.body, issue.user.login) });
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

  function projectCard(login, r) {
    const a = el("a", "card");
    a.href = "#/" + login + "/" + r.name;
    a.append(el("h4", null, r.name));
    if (r.description) a.append(el("p", null, r.description));
    const meta = el("div", "meta");
    if (r.language) meta.append(el("span", "lang", r.language));
    meta.append(el("span", null, "Updated " + new Date(r.pushedAt).toLocaleDateString()));
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
    const panes = el("div", "compare");
    panes.append(comparePane(versions, 0), comparePane(versions, Math.min(1, versions.length - 1)));
    app.replaceChildren(head, panes);
  }

  function comparePane(versions, start) {
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
    bar.append(who, file, open);
    const body = el("div", "pane-body");
    pane.append(bar, body);

    function pickPerson() {
      const v = versions[Number(who.value)];
      open.href = "#/" + v.login + "/" + v.repo.name;
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
        if (versions[Number(who.value)] === v && file.value === path) body.replaceChildren(codeBlock(text, path));
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

  function showAddMe() {
    current = null;
    document.title = "Add my projects · " + (cfg.title || "Class Code Showcase");
    app.innerHTML = "";
    const page = el("section", "add-me");
    page.append(backLink(), el("h1", null, "Add my projects"),
      el("p", "muted", "Type your GitHub username, tick the projects you want to show, then confirm on GitHub."));

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
    app.append(page);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const login = input.value.trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//i, "").replace(/\/.*$/, "");
      if (!NAME.test(login)) {
        results.replaceChildren(el("p", "error", "That doesn't look like a GitHub username."));
        return;
      }
      try { localStorage.setItem("showcase-username", login); } catch (err) { /* fine */ }
      results.replaceChildren(el("p", "muted", "Looking up " + login + "…"));
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
          results.replaceChildren(el("p", "error", err.message === "not-found" ? "No GitHub user named " + login + "." : errorText(err)));
          return;
        }
        repos = repos.filter((r) => !r.fork && r.full_name.toLowerCase() !== SITE_REPO.toLowerCase());
      }
      // Tick what shows today if they've added before; otherwise their Java repos.
      let showing = null;
      const hit = d && d.people.find((p) => p.login.toLowerCase() === login.toLowerCase());
      if (hit) showing = new Set(hit.repos.map((r) => r.name.toLowerCase()));
      renderPicker(results, login, repos, showing);
    });
    if (input.value) form.requestSubmit();
  }

  function renderPicker(box, login, repos, showing) {
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

    const go = el("a", "btn primary", "Continue to GitHub");
    go.target = "_blank";
    go.rel = "noopener";
    const steps = el("ol", "after");
    const s1 = el("li");
    s1.append("On GitHub, click ", el("strong", null, "Create"), ". That's it.");
    steps.append(s1, el("li", null, "Come back to the gallery. Your picks show up within a few minutes."),
      el("li", null, "Want to change them later? Do this again. Your newest one counts."));

    function update() {
      const names = [...list.querySelectorAll("input:checked")].map((c) => c.value);
      count.textContent = names.length + " of " + repos.length + " selected";
      go.href = "https://github.com/" + SITE_REPO + "/issues/new?template=add-me.yml&title=" +
        encodeURIComponent("Add me: " + login) + "&repos=" + encodeURIComponent(names.join("\n"));
      go.classList.toggle("disabled", names.length === 0);
    }
    list.addEventListener("change", update);
    const status = el("div", "status");
    go.addEventListener("click", (e) => {
      if (go.classList.contains("disabled")) {
        e.preventDefault();
        return;
      }
      waitForForm(status, login, new Date(Date.now() - 60000).toISOString());
    });
    update();
    box.replaceChildren(el("h2", null, "Pick your projects"), tools, list, go, status, steps);
  }

  // Check GitHub for their new form when they come back to this tab (and on a button), not on a timer,
  // so a whole class doing this at once stays well under GitHub's limit.
  function waitForForm(box, login, since) {
    const again = el("button", "link", "Check again");
    again.type = "button";
    const msg = el("span", null, "Waiting for you to click Create on GitHub… ");
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
        const see = el("a", "btn primary", "See the gallery");
        see.href = "#/";
        box.className = "status ok";
        box.replaceChildren(el("span", null, "You're on the site! Your projects show for everyone now. "), see);
      } else {
        msg.textContent = "Not yet. After you click Create on GitHub, come back here. ";
      }
    }
    again.addEventListener("click", check);
    window.addEventListener("focus", check);
    window.addEventListener("hashchange", () => { done = true; window.removeEventListener("focus", check); }, { once: true });
  }

  // ---------- project viewer ----------

  async function showProject(owner, repo, path) {
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
    openFile(path);
  }

  function renderShell(owner, repo, files) {
    app.innerHTML = "";
    const bar = el("div", "project-bar");
    const who = el("div", "who");
    const names = el("div");
    names.append(el("div", "owner", owner), el("h1", null, repo));
    who.append(avatar(owner), names);
    const links = el("div", "links");
    links.append(
      extLink("https://github.com/" + owner + "/" + repo, "View on GitHub"),
      extLink("https://github.dev/" + owner + "/" + repo, "Open in web editor")
    );
    bar.append(backLink(), who, links);

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
    app.append(bar, layout, comments);
    renderComments(owner, repo, comments);
  }

  // Open the file with main() first, for repos the class list doesn't cover.
  async function pickStartFile(owner, repo, files) {
    const java = files.filter((f) => f.endsWith(".java")).slice(0, 15);
    const texts = await Promise.all(java.map((f) => getFile(owner, repo, f).catch(() => "")));
    const withMain = java.find((f, i) => /static\s+void\s+main\s*\(/.test(texts[i]));
    return withMain || java[0] || files.find((f) => /readme/i.test(f)) || files[0] || "";
  }

  async function openFile(path) {
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
    viewer.replaceChildren(el("div", "file-head", path), el("p", "muted pad", "Loading…"));
    let text;
    try {
      text = await getFile(current.owner, current.repo, path);
    } catch (err) {
      viewer.replaceChildren(el("div", "file-head", path), el("p", "error pad", errorText(err)));
      return;
    }
    viewer.replaceChildren(el("div", "file-head", path), codeBlock(text, path));
  }

  function codeBlock(text, path) {
    const ext = (path.split(".").pop() || "").toLowerCase();
    const lang = LANGS[ext] || "plaintext";
    const lines = text.replace(/\n$/, "").split("\n");
    const wrap = el("div", "code");
    const gutter = el("pre", "gutter");
    gutter.setAttribute("aria-hidden", "true");
    gutter.textContent = lines.map((_, i) => i + 1).join("\n");
    const pre = el("pre", "source");
    const code = el("code", "hljs");
    if (window.hljs && hljs.getLanguage(lang)) {
      code.innerHTML = hljs.highlight(lines.join("\n"), { language: lang, ignoreIllegals: true }).value;
    } else {
      code.textContent = lines.join("\n");
    }
    pre.append(code);
    wrap.append(gutter, pre);
    return wrap;
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
