const firebaseConfig = {
    apiKey: "AIzaSyBHUjki5Ezg58AqYf14OrNlCIgjmlZsgPw",
    authDomain: "ghgghg-om52uo.firebaseapp.com",
    projectId: "ghgghg-om52uo",
    storageBucket: "ghgghg-om52uo.appspot.com",
    messagingSenderId: "151770579575",
    appId: "1:151770579575:web:24569742abdfefeb02fc72"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  const grid = document.getElementById('video-grid');
  const bottomNav = document.getElementById('bottom-nav');
  const loadMoreWrap = document.getElementById('load-more-wrap');
  const PAGE_SIZE = 6;

  // Each tab keeps its own separate list, cursor, and "more data available" flag,
  // so Latest and Viral behave like two independent screens that each page in 6 at a time.
  const state = {
    latest: { field: 'createdAt', docs: [], lastDoc: null, hasMore: true, loaded: false, scrollY: 0 },
    viral:  { field: 'views',     docs: [], lastDoc: null, hasMore: true, loaded: false, scrollY: 0 }
  };
  let currentMode = 'latest';
  let isFetching = false;

  function fetchNextPage(mode) {
    const s = state[mode];
    if (!s.hasMore) return Promise.resolve();

    let query = db.collection('videos').orderBy(s.field, 'desc').limit(PAGE_SIZE);
    if (s.lastDoc) query = query.startAfter(s.lastDoc);

    return query.get().then(snapshot => {
      s.loaded = true;
      if (snapshot.empty) {
        s.hasMore = false;
        return;
      }
      snapshot.docs.forEach(doc => s.docs.push({ ...doc.data(), _id: doc.id }));
      s.lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < PAGE_SIZE) s.hasMore = false;
    });
  }

  function render() {
    const s = state[currentMode];
    grid.innerHTML = '';
    if (s.docs.length === 0) {
      grid.innerHTML = '<div class="state">No videos yet. Add documents to the <span class="red">videos</span> collection in Firestore.</div>';
    } else {
      s.docs.forEach(v => grid.appendChild(buildCard(v)));
    }
    loadMoreWrap.classList.add('hidden');
    // Restore this tab's own scroll position rather than inheriting whatever
    // position the other tab was scrolled to.
    requestAnimationFrame(() => window.scrollTo(0, s.scrollY));
  }

  function showTab(mode) {
    currentMode = mode;
    const s = state[mode];
    if (!s.loaded) {
      grid.innerHTML = '<div class="skeleton"><div class="thumb-wrap"></div><div class="line"></div><div class="line short"></div></div>'.repeat(6);
      loadMoreWrap.classList.add('hidden');
      isFetching = true;
      fetchNextPage(mode).then(() => {
        isFetching = false;
        render();
      }).catch(err => {
        isFetching = false;
        console.error('Error loading videos:', err);
        grid.innerHTML = '<div class="state">Couldn\'t load videos. Check your Firebase config and Firestore rules.</div>';
      });
    } else {
      render();
    }
  }

  // Automatically fetches the next page of 6 once the sentinel near the
  // bottom of the page scrolls into view — no button needed.
  function maybeLoadMore() {
    const mode = currentMode;
    const s = state[mode];
    if (isFetching || !s.loaded || !s.hasMore) return;
    isFetching = true;
    loadMoreWrap.classList.remove('hidden');
    const countBefore = s.docs.length;
    fetchNextPage(mode).then(() => {
      isFetching = false;
      if (mode !== currentMode) return; // user switched tabs mid-fetch
      s.docs.slice(countBefore).forEach(v => grid.appendChild(buildCard(v)));
      loadMoreWrap.classList.toggle('hidden', !s.hasMore);
    }).catch(err => {
      isFetching = false;
      console.error('Error loading more videos:', err);
      loadMoreWrap.classList.add('hidden');
    });
  }

  const scrollSentinel = document.getElementById('scroll-sentinel');
  const scrollObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) maybeLoadMore();
  }, { rootMargin: '0px 0px 400px 0px' });
  scrollObserver.observe(scrollSentinel);

  const tabOrder = { latest: 0, viral: 1 };

  bottomNav.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === currentMode) return;
      state[currentMode].scrollY = window.scrollY;
      bottomNav.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      bottomNav.classList.toggle('viral', mode === 'viral');

      const goingForward = tabOrder[mode] > tabOrder[currentMode];
      const outClass = goingForward ? 'slide-out-left' : 'slide-out-right';
      const inClass = goingForward ? 'slide-in-right' : 'slide-in-left';

      grid.classList.add(outClass);
      setTimeout(() => {
        showTab(mode);
        grid.classList.remove(outClass);
        grid.classList.add(inClass);
        void grid.offsetWidth; // force reflow so the entering position applies before animating
        requestAnimationFrame(() => grid.classList.remove(inClass));
      }, 200);
    });
  });

  // Initial load — first 6 "Latest" videos
  showTab('latest');

  function buildCard(v) {
    const card = document.createElement('div');
    card.className = 'card';

    const thumb = v.image || 'https://placehold.co/480x270/17171a/9a9aa1?text=No+Thumbnail';
    const duration = v.duration ? `<span class="duration">${escapeHtml(v.duration)}</span>` : '';
    const dateLabel = formatDate(v.createdAt);

    card.innerHTML = `
      <div class="thumb-wrap">
        <img src="${escapeHtml(thumb)}" alt="${escapeHtml(v.title || 'Video thumbnail')}" loading="lazy">
        ${duration}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(v.title || 'Untitled video')}</div>
        <div class="card-meta">${[v.views != null ? formatViews(v.views) + ' views' : '', dateLabel].filter(Boolean).join(' · ')}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      incrementViews(v._id);
      if (v.link1) window.open(v.link1, '_blank', 'noopener');
    });

    return card;
  }

  // Bumps the tapped video's views count in Firestore by 1. Fire-and-forget —
  // we don't block navigation on it, and failures are just logged.
  function incrementViews(id) {
    if (!id) return;
    db.collection('videos').doc(id).update({
      views: firebase.firestore.FieldValue.increment(1)
    }).catch(err => console.error('Failed to increment views:', err));
  }

  function formatDate(date) {
    if (!date) return '';
    // Firestore Timestamp objects have a toDate() method; plain strings pass through.
    const d = typeof date.toDate === 'function' ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return String(date);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatViews(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
    return String(n);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  // ---- Search screen ----
  // Queries Firestore directly for each keystroke (debounced) using a prefix
  // range query on `title`, rather than filtering already-loaded videos.
  // Firestore has no native "contains" search, so this matches titles that
  // START WITH the typed text, and is case-sensitive against what's stored.
  const searchOverlay = document.getElementById('search-overlay');
  const searchOpenBtn = document.getElementById('search-open');
  const searchCloseBtn = document.getElementById('search-close');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');

  let searchDebounceTimer = null;
  let searchRequestId = 0;

  function runFirestoreSearch(query) {
    const q = query.trim();
    if (!q) {
      searchResults.innerHTML = '<div class="state">Start typing to search by video title.</div>';
      return;
    }

    const thisRequestId = ++searchRequestId;
    searchResults.innerHTML = '<div class="state">Searching…</div>';

    db.collection('videos')
      .orderBy('title')
      .startAt(q)
      .endAt(q + '\uf8ff')
      .limit(20)
      .get()
      .then(snapshot => {
        if (thisRequestId !== searchRequestId) return; // a newer keystroke superseded this search
        if (snapshot.empty) {
          searchResults.innerHTML = '<div class="state">No titles start with that text. Search is case-sensitive and matches from the start of the title.</div>';
          return;
        }
        searchResults.innerHTML = '';
        snapshot.forEach(doc => searchResults.appendChild(buildResultRow({ ...doc.data(), _id: doc.id })));
      })
      .catch(err => {
        if (thisRequestId !== searchRequestId) return;
        console.error('Search error:', err);
        searchResults.innerHTML = '<div class="state">Search failed. Check the Firestore console for an index prompt — a query with orderBy + startAt/endAt on "title" sometimes needs one.</div>';
      });
  }

  function buildResultRow(v) {
    const row = document.createElement('div');
    row.className = 'result-row';
    const thumb = v.image || 'https://placehold.co/480x270/17171a/9a9aa1?text=No+Thumbnail';
    row.innerHTML = `
      <div class="thumb"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(v.title || '')}" loading="lazy"></div>
      <div class="info">
        <div class="title">${escapeHtml(v.title || 'Untitled video')}</div>
        <div class="meta">${[v.views != null ? formatViews(v.views) + ' views' : '', formatDate(v.createdAt)].filter(Boolean).join(' · ')}</div>
      </div>
    `;
    // Clicking anywhere on the row (thumbnail, title, or meta) opens link1.
    row.addEventListener('click', () => {
      incrementViews(v._id);
      if (v.link1) window.open(v.link1, '_blank', 'noopener');
    });
    return row;
  }

  function openSearch() {
    searchOverlay.classList.add('open');
    runFirestoreSearch(searchInput.value);
    setTimeout(() => searchInput.focus(), 150);
  }

  function closeSearch() {
    searchOverlay.classList.remove('open');
  }

  searchOpenBtn.addEventListener('click', openSearch);
  searchCloseBtn.addEventListener('click', closeSearch);
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    const value = searchInput.value;
    searchDebounceTimer = setTimeout(() => runFirestoreSearch(value), 300);
  });

  // ---- Menu popup (Privacy Policy, Terms, About) ----
  const menuOpenBtn = document.getElementById('menu-open');
  const menuPopup = document.getElementById('menu-popup');
  const menuBackdrop = document.getElementById('menu-backdrop');
  const infoOverlay = document.getElementById('info-overlay');
  const infoTitle = document.getElementById('info-title');
  const infoBody = document.getElementById('info-body');
  const infoCloseBtn = document.getElementById('info-close');

  // Placeholder copy — swap in your real policy/about text.
  const menuContent = {
    privacy: {
      title: 'Privacy Policy',
      paragraphs: [
        'vid4hub does not host, store, or upload any video files on its own servers. We only index and display links to videos that are hosted elsewhere on the internet.',
        'We do not claim ownership of, or responsibility for, any video content linked through this site. All videos remain the property of their original hosts and creators.',
        'We collect only basic usage data, such as which links are viewed, to improve the browsing experience. This data is not sold to third parties.',
        'If you believe a linked video infringes your rights or should not be listed, please reach out to the original hosting platform, as vid4hub does not control or store the underlying video content.'
      ]
    },
    terms: {
      title: 'Terms & Conditions',
      paragraphs: [
        'By using vid4hub, you agree to use the platform responsibly and not to misuse or attempt to disrupt the service.',
        'Content is linked from third-party sources; vid4hub is not responsible for the availability, accuracy, or legality of external links.',
        'These terms may be updated from time to time, and continued use of the app constitutes acceptance of any changes.'
      ]
    },
    about: {
      title: 'About Us',
      paragraphs: [
        'vid4hub is a lightweight video discovery hub, surfacing the latest and most-viewed videos in one place.',
        'Built to be fast, simple, and easy to browse on any device.'
      ]
    }
  };

  function openMenu() {
    menuPopup.classList.add('open');
    menuBackdrop.classList.add('open');
  }

  function closeMenu() {
    menuPopup.classList.remove('open');
    menuBackdrop.classList.remove('open');
  }

  function openInfo(key) {
    const content = menuContent[key];
    if (!content) return;
    infoTitle.textContent = content.title;
    infoBody.innerHTML = content.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');
    infoOverlay.classList.add('open');
  }

  function closeInfo() {
    infoOverlay.classList.remove('open');
  }

  menuOpenBtn.addEventListener('click', openMenu);

  // ---- Top banner opens the Play Store listing ----
  // Replace this with your actual Play Store URL.
  const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.diskwalaapp';
  document.getElementById('banner').addEventListener('click', () => {
    window.open(PLAY_STORE_URL, '_blank', 'noopener');
  });
  menuBackdrop.addEventListener('click', closeMenu);
  infoCloseBtn.addEventListener('click', closeInfo);

  menuPopup.querySelectorAll('.menu-item').forEach(btn => {
    btn.addEventListener('click', () => {
      closeMenu();
      openInfo(btn.dataset.key);
    });
  });
