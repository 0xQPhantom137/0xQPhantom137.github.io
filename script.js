/* =========================================================
   0xQPhantom137
   Populates the Projects, Stack, and Now sections with
   data from the public GitHub API.
   ========================================================= */
(() => {
  "use strict";

  /* ---------------------------------------------------------
     Configuration
     --------------------------------------------------------- */
  const GITHUB_USER    = "0xQPhantom137";
  const MAX_PROJECTS   = 5;
  const MAX_STACK      = 12;
  const MAX_NOW_ROWS   = 4;
  const CACHE_KEY      = `gh-data:${GITHUB_USER}`;
  const CACHE_TTL_MS   = 30 * 60 * 1000;

  const REPOS_URL  = `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=pushed`;
  const EVENTS_URL = `https://api.github.com/users/${GITHUB_USER}/events/public?per_page=100`;
  const USER_URL   = `https://api.github.com/users/${GITHUB_USER}`;
  const API_HEADERS = { Accept: "application/vnd.github+json" };

  /* Language colors as defined by GitHub */
  const LANG_COLORS = {
    JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
    HTML: "#e34c26", CSS: "#563d7c", SCSS: "#c6538c",
    Shell: "#89e051", Bash: "#89e051", Go: "#00ADD8", Rust: "#dea584",
    Java: "#b07219", "C++": "#f34b7d", C: "#555555", "C#": "#178600",
    Ruby: "#701516", PHP: "#4F5D95", Swift: "#F05138", Kotlin: "#A97BFF",
    Dart: "#00B4AB", Vue: "#41b883", Svelte: "#ff3e00", Lua: "#000080",
    Elixir: "#6e4a7e", Haskell: "#5e5086", R: "#198CE7", Scala: "#c22d40",
    Zig: "#ec915c", Nix: "#7e7eff", Dockerfile: "#384d54", Makefile: "#427819",
    "Jupyter Notebook": "#DA5B0B",
  };

  /* ---------------------------------------------------------
     Utilities
     --------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);

  const escapeHTML = (str) =>
    String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  function timeAgo(dateStr) {
    const then = new Date(dateStr).getTime();
    if (Number.isNaN(then)) return "";
    const days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7)  return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  const formatNumber = (n) =>
    n < 1000 ? String(n) : (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";

  const langColor = (lang) => (lang && LANG_COLORS[lang]) || "#8b8b95";

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  /* ---------------------------------------------------------
     GitHub data: fetch and cache
     --------------------------------------------------------- */
  function readCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      /* A cache entry missing the account payload predates the USER_URL
         addition — treat it as stale so the stat can populate. */
      if (!parsed.data || !parsed.data.user) return null;
      const stale = Date.now() - parsed.ts > CACHE_TTL_MS;
      return { data: parsed.data, stale };
    } catch {
      return null;
    }
  }

  function writeCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {
      /* sessionStorage may be unavailable in some contexts */
    }
  }

  async function fetchGitHubData() {
    const cached = readCache();
    if (cached && !cached.stale) {
      return { ...cached.data, source: "cache" };
    }

    /* All three endpoints are requested in parallel. A failure in one does
       not prevent the others from rendering. */
    const [reposRes, eventsRes, userRes] = await Promise.allSettled([
      fetch(REPOS_URL, { headers: API_HEADERS }),
      fetch(EVENTS_URL, { headers: API_HEADERS }),
      fetch(USER_URL, { headers: API_HEADERS }),
    ]);

    let repos  = cached?.data?.repos  || [];
    let events = cached?.data?.events || [];
    let user   = cached?.data?.user   || null;

    if (reposRes.status === "fulfilled" && reposRes.value.ok) {
      try { repos = await reposRes.value.json(); } catch { /* keep cached value */ }
    } else if (!repos.length) {
      throw new Error("Failed to load repositories");
    }

    if (eventsRes.status === "fulfilled" && eventsRes.value.ok) {
      try { events = await eventsRes.value.json(); } catch { /* keep cached value */ }
    }

    if (userRes.status === "fulfilled" && userRes.value.ok) {
      try { user = await userRes.value.json(); } catch { /* keep cached value */ }
    }

    const data = { repos, events, user, fetchedAt: Date.now() };
    writeCache(data);
    return { ...data, source: "network" };
  }

  /* ---------------------------------------------------------
     Derivation helpers
     --------------------------------------------------------- */

  /* Repos owned by the user: excludes forks, archived repos, and the
     profile README repository. */
  function ownedRepos(repos) {
    return (repos || []).filter(
      (r) => !r.fork && !r.archived && r.name !== GITHUB_USER
    );
  }

  /* Updates the "Building things" stat with the time elapsed since the
     GitHub account was created. Leaves the fallback in place if the
     account payload is unavailable. */
  function updateBuildingStat(user) {
    const el = document.getElementById("statYears");
    if (!el || !user?.created_at) return;

    const created = new Date(user.created_at).getTime();
    if (!Number.isFinite(created)) return;

    const days = (Date.now() - created) / 86400000;

    if (days < 365) {
      const months = Math.max(1, Math.round(days / 30.44));
      el.innerHTML = `~${months}<span>mo</span>`;
    } else {
      const years = (days / 365.25).toFixed(1).replace(/\.0$/, "");
      el.innerHTML = `~${years}<span>yr</span>`;
    }
  }

  /* Top repositories for the Projects grid, sorted by star count and
     then by most recent push. */
  function selectProjects(repos) {
    return ownedRepos(repos)
      .sort((a, b) => {
        if (b.stargazers_count !== a.stargazers_count) {
          return b.stargazers_count - a.stargazers_count;
        }
        return new Date(b.pushed_at) - new Date(a.pushed_at);
      })
      .slice(0, MAX_PROJECTS);
  }

  /* Language frequency across owned repositories. */
  function deriveStack(repos) {
    const counts = {};
    for (const r of ownedRepos(repos)) {
      if (r.language) counts[r.language] = (counts[r.language] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_STACK)
      .map(([lang, count]) => ({ lang, count }));
  }

  /* Rows for the Now section, built from repository and event data. */
  function deriveNow(repos, events) {
    const own = ownedRepos(repos);
    const rows = [];
    const nowMs = Date.now();
    const DAY = 86400000;

    if (!own.length && !events?.length) return rows;

    /* Most recently pushed repository */
    const byPush = [...own].sort(
      (a, b) => new Date(b.pushed_at) - new Date(a.pushed_at)
    );
    const active = byPush[0];
    if (active) {
      rows.push({
        key: "Building",
        html:
          `<a class="now__link" href="${escapeHTML(active.html_url)}" ` +
          `target="_blank" rel="noopener noreferrer">${escapeHTML(active.name)}</a>` +
          ` — last push ${timeAgo(active.pushed_at)}`,
      });
    }

    /* Newest repository, shown only when different from the one above */
    const byCreate = [...own].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    const newest = byCreate[0];
    if (newest && newest.name !== active?.name) {
      rows.push({
        key: "Latest",
        html:
          `<a class="now__link" href="${escapeHTML(newest.html_url)}" ` +
          `target="_blank" rel="noopener noreferrer">${escapeHTML(newest.name)}</a>` +
          ` — started ${timeAgo(newest.created_at)}`,
      });
    }

    /* Commit activity from public push events over the last 30 days */
    const pushEvents = (events || []).filter((e) => e.type === "PushEvent");

    if (pushEvents.length) {
      const cutoff = nowMs - 30 * DAY;
      let commits = 0;
      const reposTouched = new Set();

      for (const e of pushEvents) {
        if (new Date(e.created_at).getTime() < cutoff) continue;
        commits += e.payload?.commits?.length || e.payload?.size || 0;
        const name = e.repo?.name?.split("/")[1];
        if (name) reposTouched.add(name);
      }

      if (commits > 0) {
        rows.push({
          key: "Activity",
          html:
            `${plural(commits, "commit")} across ` +
            `${plural(reposTouched.size, "repo")} in the last 30 days`,
        });
      } else {
        rows.push({
          key: "Activity",
          html: `Quiet lately — last push ${timeAgo(pushEvents[0].created_at)}`,
        });
      }
    }

    /* Dominant language among recently touched repositories */
    const recentRepoNames = new Set();
    for (const e of (events || []).slice(0, 60)) {
      const name = e.repo?.name?.split("/")[1];
      if (name) recentRepoNames.add(name);
    }

    const focusCounts = {};
    for (const r of own) {
      if (recentRepoNames.has(r.name) && r.language) {
        focusCounts[r.language] = (focusCounts[r.language] || 0) + 1;
      }
    }
    const focus = Object.entries(focusCounts).sort((a, b) => b[1] - a[1])[0];

    if (focus) {
      rows.push({
        key: "Focus",
        html: `Mostly <span class="now__em">${escapeHTML(focus[0])}</span> lately`,
      });
    } else {
      const allCounts = {};
      for (const r of own) {
        if (r.language) allCounts[r.language] = (allCounts[r.language] || 0) + 1;
      }
      const top = Object.entries(allCounts).sort((a, b) => b[1] - a[1])[0];
      if (top) {
        rows.push({
          key: "Focus",
          html: `Mostly writing <span class="now__em">${escapeHTML(top[0])}</span>`,
        });
      }
    }

    return rows.slice(0, MAX_NOW_ROWS);
  }

  /* ---------------------------------------------------------
     Inline SVG icons
     --------------------------------------------------------- */
  const ICON_REPO = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
  const ICON_STAR = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const ICON_FORK = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/></svg>`;
  const ICON_ARROW = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12L12 4M12 4H6M12 4v6"/></svg>`;
  const ICON_ALERT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`;
  const ICON_EMPTY = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;

  /* ---------------------------------------------------------
     Status pill helpers
     --------------------------------------------------------- */
  function makeStatusSetter(id) {
    const el = document.getElementById(id);
    const textEl = el?.querySelector(".projects__status-text");
    const dotEl = el?.querySelector(".projects__dot");
    return (state, text) => {
      if (!el || !textEl || !dotEl) return;
      dotEl.className = `projects__dot projects__dot--${state}`;
      textEl.textContent = text;
    };
  }

  const setProjectsStatus = makeStatusSetter("projectsStatus");
  const setStackStatus    = makeStatusSetter("stackStatus");
  const setNowStatus      = makeStatusSetter("nowStatus");

  /* ---------------------------------------------------------
     Projects rendering
     --------------------------------------------------------- */
  const projectsGrid = $("#projectsGrid");

  function renderProjectSkeletons(count = 3) {
    if (!projectsGrid) return;
    const cards = [];
    for (let i = 0; i < count; i++) {
      const wide = i === 0 ? " card--wide" : "";
      cards.push(`
        <div class="card card--skeleton${wide}" aria-hidden="true">
          <div class="card__top">
            <div class="sk sk-icon"></div>
            <div class="sk sk-badge"></div>
          </div>
          <div class="sk sk-title"></div>
          <div class="sk sk-line"></div>
          <div class="sk sk-line sk-line--short"></div>
          <div class="sk sk-footer"></div>
        </div>
      `);
    }
    projectsGrid.innerHTML = cards.join("");
  }

  function renderRepoCard(repo, index) {
    const wide = index === 0 ? " card--wide" : "";
    const lang = repo.language;
    const desc = repo.description?.trim();

    const badge = lang
      ? `<span class="card__badge"><span class="lang-dot" style="background:${langColor(lang)}"></span>${escapeHTML(lang)}</span>`
      : `<span class="card__badge">Repo</span>`;

    const descHTML = desc
      ? `<p class="card__desc">${escapeHTML(desc)}</p>`
      : `<p class="card__desc card__desc--muted">No description yet.</p>`;

    const topics = (repo.topics || []).slice(0, 4);
    const topicsHTML = topics.length
      ? `<div class="card__topics">${topics
          .map((t) => `<span class="topic">${escapeHTML(t)}</span>`)
          .join("")}</div>`
      : "";

    const stars = repo.stargazers_count || 0;
    const forks = repo.forks_count || 0;
    const metrics = [
      stars > 0 ? `<span class="metric">${ICON_STAR}${formatNumber(stars)}</span>` : "",
      forks > 0 ? `<span class="metric">${ICON_FORK}${formatNumber(forks)}</span>` : "",
    ].filter(Boolean).join("");

    return `
      <a href="${escapeHTML(repo.html_url)}" target="_blank" rel="noopener noreferrer" class="card${wide}">
        <div class="card__top">
          <div class="card__icon">${ICON_REPO}</div>
          ${badge}
        </div>
        <h3 class="card__title">${escapeHTML(repo.name)}</h3>
        ${descHTML}
        ${topicsHTML}
        <div class="card__footer">
          <div class="card__metrics">${metrics || `<span class="metric">—</span>`}</div>
          <span class="card__updated">updated ${timeAgo(repo.pushed_at)}</span>
        </div>
      </a>
    `;
  }

  function renderCTA() {
    return `
      <div class="card card--cta card--wide">
        <h3 class="card__title">More on GitHub</h3>
        <p class="card__desc">
          New experiments land there first. Follow along if you like watching
          things get built (and occasionally broken).
        </p>
        <a href="https://github.com/${GITHUB_USER}" target="_blank" rel="noopener noreferrer" class="card__link">
          github.com/${GITHUB_USER}
          ${ICON_ARROW}
        </a>
      </div>
    `;
  }

  function renderProjects(repos) {
    if (!projectsGrid) return;
    projectsGrid.innerHTML =
      repos.map((r, i) => renderRepoCard(r, i)).join("") + renderCTA();
    staggerFadeIn(projectsGrid);
  }

  function renderProjectsError(message) {
    if (!projectsGrid) return;
    projectsGrid.innerHTML = `
      <div class="state">
        <div class="state__icon">${ICON_ALERT}</div>
        <div class="state__title">Couldn't load projects</div>
        <p class="state__desc">${escapeHTML(message)}</p>
        <a href="https://github.com/${GITHUB_USER}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost">
          View on GitHub ${ICON_ARROW}
        </a>
      </div>
    `;
  }

  function renderProjectsEmpty() {
    if (!projectsGrid) return;
    projectsGrid.innerHTML = `
      <div class="state">
        <div class="state__icon">${ICON_EMPTY}</div>
        <div class="state__title">No public repos yet</div>
        <p class="state__desc">Nothing published at the moment — new experiments drop soon.</p>
        <a href="https://github.com/${GITHUB_USER}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost">
          Follow on GitHub ${ICON_ARROW}
        </a>
      </div>
    `;
  }

  /* ---------------------------------------------------------
     Stack rendering
     --------------------------------------------------------- */
  const stackGrid = $("#stackGrid");

  function renderStackSkeletons(count = 8) {
    if (!stackGrid) return;
    const pills = [];
    for (let i = 0; i < count; i++) {
      const w = 60 + ((i * 17) % 60);
      pills.push(
        `<span class="pill pill--skeleton" aria-hidden="true"><span class="sk sk-pill" style="width:${w}px"></span></span>`
      );
    }
    stackGrid.innerHTML = pills.join("");
  }

  function renderStack(items) {
    if (!stackGrid) return;
    if (!items.length) {
      stackGrid.innerHTML =
        `<p class="stack__empty">No public code yet — check back soon.</p>`;
      return;
    }
    stackGrid.innerHTML = items
      .map(
        ({ lang, count }) => `
          <span class="pill" title="${escapeHTML(lang)} — ${count} repo${count === 1 ? "" : "s"}">
            <span class="lang-dot" style="background:${langColor(lang)}"></span>
            ${escapeHTML(lang)}
            <span class="pill__count">×${count}</span>
          </span>
        `
      )
      .join("");
    staggerFadeIn(stackGrid);
  }

  function renderStackError() {
    if (!stackGrid) return;
    stackGrid.innerHTML =
      `<p class="stack__empty">Couldn't load language data right now.</p>`;
  }

  /* ---------------------------------------------------------
     Now rendering
     --------------------------------------------------------- */
  const nowGrid = $("#nowGrid");

  function renderNowSkeletons(count = 3) {
    if (!nowGrid) return;
    const rows = [];
    for (let i = 0; i < count; i++) {
      rows.push(`
        <div class="now__row now__row--skeleton" aria-hidden="true">
          <span class="sk sk-now-key"></span>
          <span class="sk sk-now-val"></span>
        </div>
      `);
    }
    nowGrid.innerHTML = rows.join("");
  }

  function renderNow(rows) {
    if (!nowGrid) return;
    if (!rows.length) {
      nowGrid.innerHTML = `
        <div class="now__row">
          <span class="now__key">Status</span>
          <span class="now__val">Not much public activity yet — check back soon.</span>
        </div>
      `;
      return;
    }
    nowGrid.innerHTML = rows
      .map(
        ({ key, html }) => `
          <div class="now__row">
            <span class="now__key">${escapeHTML(key)}</span>
            <span class="now__val">${html}</span>
          </div>
        `
      )
      .join("");
    staggerFadeIn(nowGrid);
  }

  function renderNowError() {
    if (!nowGrid) return;
    nowGrid.innerHTML = `
      <div class="now__row">
        <span class="now__key">Status</span>
        <span class="now__val">Couldn't reach GitHub right now.</span>
      </div>
    `;
  }

  /* ---------------------------------------------------------
     Shared animation helper
     --------------------------------------------------------- */
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function staggerFadeIn(root) {
    if (prefersReduced) return;
    const items = root.querySelectorAll(".card, .pill, .now__row");
    items.forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(10px)";
      el.style.transition = `opacity 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 0.04}s, transform 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 0.04}s, border-color 0.25s ease, background 0.25s ease`;
      requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
    });
  }

  /* ---------------------------------------------------------
     UI interactions
     --------------------------------------------------------- */
  function initUI() {
    /* Scroll-triggered reveal */
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

    /* Nav background toggle on scroll */
    const nav = document.querySelector(".nav");
    const onScroll = () => nav?.classList.toggle("is-scrolled", window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    /* Active section highlighting in the nav */
    const navLinks = document.querySelectorAll(".nav__links a");
    const sections = [...document.querySelectorAll("section[id]")];
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = entry.target.id;
          navLinks.forEach((link) => {
            link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`);
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    sections.forEach((s) => sectionObserver.observe(s));

    /* Cursor-following ambient glow */
    const glow = document.querySelector(".cursor-glow");
    if (glow && !prefersReduced) {
      let tx = 0, ty = 0, cx = 0, cy = 0;
      window.addEventListener(
        "mousemove",
        (e) => { tx = e.clientX; ty = e.clientY; },
        { passive: true }
      );
      const tick = () => {
        cx += (tx - cx) * 0.14;
        cy += (ty - cy) * 0.14;
        glow.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
        requestAnimationFrame(tick);
      };
      tick();
    }

    /* Card hover spotlight. Delegated so it applies to dynamically
       rendered cards as well. */
    if (!prefersReduced && projectsGrid) {
      projectsGrid.addEventListener(
        "mousemove",
        (e) => {
          const card = e.target.closest(".card");
          if (!card) return;
          const rect = card.getBoundingClientRect();
          card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
          card.style.setProperty("--my", `${e.clientY - rect.top}px`);
        },
        { passive: true }
      );
    }

    /* Smooth anchor scrolling with an offset for the fixed header */
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener("click", (e) => {
        const id = link.getAttribute("href");
        if (id === "#" || id.length < 2) return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: prefersReduced ? "auto" : "smooth" });
      });
    });
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  async function loadAll() {
    renderProjectSkeletons(3);
    renderStackSkeletons(8);
    renderNowSkeletons(3);
    setProjectsStatus("loading", "Loading…");
    setStackStatus("loading", "Loading…");
    setNowStatus("loading", "Loading…");

    try {
      const { repos, events, user, source } = await fetchGitHubData();

      /* About stat — based on GitHub account age */
      updateBuildingStat(user);

      /* Projects */
      const projects = selectProjects(repos);
      if (!projects.length) {
        renderProjectsEmpty();
        setProjectsStatus("live", "0 public repos");
      } else {
        renderProjects(projects);
        const label = source === "cache"
          ? `${projects.length} repos · cached`
          : `${plural(projects.length, "repo")} · live`;
        setProjectsStatus("live", label);
      }

      /* Stack */
      const stack = deriveStack(repos);
      if (stack.length) {
        renderStack(stack);
        const total = stack.reduce((s, x) => s + x.count, 0);
        setStackStatus("live", `${plural(stack.length, "language")} · ${plural(total, "repo")}`);
      } else {
        renderStack([]);
        setStackStatus("live", "No languages yet");
      }

      /* Now */
      const nowRows = deriveNow(repos, events);
      renderNow(nowRows);
      setNowStatus("live", nowRows.length ? "From recent activity" : "No recent activity");

    } catch (err) {
      renderProjectsError("GitHub's API isn't responding right now. Try again in a bit.");
      renderStackError();
      renderNowError();
      setProjectsStatus("error", "Unavailable");
      setStackStatus("error", "Unavailable");
      setNowStatus("error", "Unavailable");
    }
  }

  initUI();
  loadAll();
})();