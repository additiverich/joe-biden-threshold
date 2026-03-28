const THRESHOLD_DAYS = 29829;
let currentEntityId = null;
let currentSlug = null;

function slugify(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function formatDate(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(a, b) {
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function parseWikidataDate(value) {
  if (!value) return null;
  // Wikidata dates look like "+1942-11-20T00:00:00Z"
  const match = value.match(/([+-]?\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = parseInt(match[1]);
  const month = parseInt(match[2]);
  const day = parseInt(match[3]);
  if (month === 0 || day === 0) return null; // unknown month/day
  return new Date(year, month - 1, day);
}

async function startSearch() {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) return;

  document.getElementById('disambig').style.display = 'none';
  document.getElementById('resultCard').classList.remove('visible');
  document.getElementById('subjectPhoto').innerHTML = '<span class="initials" id="subjectInitials"></span>';
  document.getElementById('searchBtn').disabled = true;
  setStatus('Searching…');

  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&limit=8&format=json&origin=*&type=item`;
    const res = await fetch(url);
    const data = await res.json();

    const results = (data.search || []).filter(r => r.description);

    if (results.length === 0) {
      setStatus('No results found. Try a different spelling.');
      document.getElementById('searchBtn').disabled = false;
      return;
    }

    if (results.length === 1) {
      setStatus('');
      await loadEntity(results[0].id, results[0].label);
    } else {
      // Show disambiguation
      const sel = document.getElementById('disambigSelect');
      sel.innerHTML = '';
      results.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.dataset.label = r.label;
        opt.textContent = `${r.label}${r.description ? ' — ' + r.description : ''}`;
        sel.appendChild(opt);
      });
      document.getElementById('disambig').style.display = 'block';
      setStatus('');
      document.getElementById('searchBtn').disabled = false;
    }
  } catch (e) {
    setStatus('Something went wrong. Please try again.');
    document.getElementById('searchBtn').disabled = false;
  }
}

async function confirmSelection() {
  const sel = document.getElementById('disambigSelect');
  const id = sel.value;
  const label = sel.options[sel.selectedIndex].dataset.label;
  document.getElementById('disambig').style.display = 'none';
  await loadEntity(id, label);
}

async function loadEntity(entityId, label) {
  setStatus('Loading…');
  document.getElementById('searchBtn').disabled = true;

  try {
    const url = `https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`;
    const res = await fetch(url);
    const data = await res.json();
    const entity = data.entities[entityId];

    const claims = entity.claims || {};

    // Birth date — P569
    const birthClaims = claims['P569'];
    let birthDate = null;
    if (birthClaims && birthClaims[0]) {
      const val = birthClaims[0]?.mainsnak?.datavalue?.value?.time;
      birthDate = parseWikidataDate(val);
    }

    // Death date — P570
    const deathClaims = claims['P570'];
    let deathDate = null;
    if (deathClaims && deathClaims[0]) {
      const val = deathClaims[0]?.mainsnak?.datavalue?.value?.time;
      deathDate = parseWikidataDate(val);
    }

    // Description
    const desc = entity.descriptions?.en?.value || '';

    // Name
    const name = entity.labels?.en?.value || label;

    // Image — P18
    const imageClaims = claims['P18'];
    let imageFilename = null;
    if (imageClaims && imageClaims[0]) {
      imageFilename = imageClaims[0]?.mainsnak?.datavalue?.value;
    }

    if (!birthDate) {
      setStatus(`No precise birth date found for ${name} in Wikidata.`);
      document.getElementById('searchBtn').disabled = false;
      return;
    }

    currentEntityId = entityId;
    currentSlug = entityId;
    window.location.hash = entityId;

    await renderResult(name, desc, birthDate, deathDate, entityId, imageFilename);
    setStatus('');
    document.getElementById('searchBtn').disabled = false;

  } catch (e) {
    setStatus('Failed to load entity data. Please try again.');
    document.getElementById('searchBtn').disabled = false;
  }
}

function initials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

async function renderResult(name, desc, birthDate, deathDate, entityId, imageFilename) {
  // Subject photo
  const photoEl = document.getElementById('subjectPhoto');
  const initialsEl = document.getElementById('subjectInitials');

  if (imageFilename) {
    const cleanName = imageFilename.replace(/ /g, '_');
    try {
      const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(cleanName)}&prop=imageinfo&iiprop=url&iiurlwidth=160&format=json&origin=*`;
      const res = await fetch(apiUrl);
      const data = await res.json();
      const pages = data.query.pages;
      const page = Object.values(pages)[0];
      const thumbUrl = page?.imageinfo?.[0]?.thumburl;
      if (thumbUrl) {
        const img = document.createElement('img');
        img.alt = name;
        img.src = thumbUrl;
        img.onerror = () => { img.remove(); initialsEl.textContent = initials(name); };
        photoEl.innerHTML = '';
        photoEl.appendChild(img);
      } else {
        initialsEl.textContent = initials(name);
      }
    } catch (e) {
      initialsEl.textContent = initials(name);
    }
  } else {
    initialsEl.textContent = initials(name);
  }

  const thresholdDate = addDays(birthDate, THRESHOLD_DAYS);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isDeceased = !!deathDate;
  const referenceDate = isDeceased ? deathDate : today;

  const daysFromBirthToNow = daysBetween(birthDate, referenceDate);
  const daysToThreshold = daysBetween(referenceDate, thresholdDate);
  const crossedThreshold = referenceDate >= thresholdDate;

  // Verdict
  const banner = document.getElementById('verdictBanner');
  const headline = document.getElementById('verdictHeadline');
  const detail = document.getElementById('verdictDetail');

  banner.className = 'verdict-banner';

  if (isDeceased) {
    if (crossedThreshold) {
      banner.classList.add('crossed');
      const daysOver = daysBetween(thresholdDate, deathDate);
      headline.textContent = `Crossed the threshold — and kept going`;
      detail.textContent = `${name} passed Biden's threshold on ${formatDate(thresholdDate)} and lived a further ${daysOver.toLocaleString()} days beyond it before dying on ${formatDate(deathDate)}.`;
    } else {
      banner.classList.add('never');
      headline.textContent = `Never reached the threshold`;
      detail.textContent = `${name} died on ${formatDate(deathDate)}, ${Math.abs(daysToThreshold).toLocaleString()} days short of Biden's threshold.`;
    }
  } else {
    if (crossedThreshold) {
      banner.classList.add('crossed');
      const daysOver = daysBetween(thresholdDate, today);
      headline.textContent = `Has crossed the threshold`;
      detail.textContent = `${name} passed Biden's threshold on ${formatDate(thresholdDate)} and is now ${daysOver.toLocaleString()} days beyond it.`;
    } else {
      banner.classList.add('not-yet');
      headline.textContent = `Has not yet reached the threshold`;
      detail.textContent = `${name} will reach Biden's threshold on ${formatDate(thresholdDate)}, which is ${daysToThreshold.toLocaleString()} days from today.`;
    }
  }

  // Stats
  const stats = [
    ['Born', formatDate(birthDate)],
    isDeceased ? ['Died', formatDate(deathDate)] : null,
    ['Biden\'s threshold date', formatDate(thresholdDate)],
    isDeceased
      ? ['Age at death', `${daysFromBirthToNow.toLocaleString()} days`]
      : ['Age today', `${daysFromBirthToNow.toLocaleString()} days`],
    !isDeceased && !crossedThreshold
      ? ['Days until threshold', daysToThreshold.toLocaleString()]
      : null,
    crossedThreshold
      ? ['Days beyond threshold', (isDeceased ? daysBetween(thresholdDate, deathDate) : daysBetween(thresholdDate, today)).toLocaleString()]
      : null,
  ].filter(Boolean);

  const statsEl = document.getElementById('cardStats');
  statsEl.innerHTML = stats.map(([label, value]) => `
    <div class="stat-row">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
    </div>
  `).join('');

  document.getElementById('personName').textContent = name;
  document.getElementById('personDesc').textContent = desc;
  document.getElementById('wikidataLink').href = `https://www.wikidata.org/wiki/${entityId}`;
  document.getElementById('wikidataLink').textContent = `Wikidata · ${entityId} ↗`;

  document.getElementById('resultCard').classList.add('visible');

  if (window.goatcounter) {
    window.goatcounter.count({ path: 'search/' + entityId, title: name });
  }
}

function copyLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.share-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy link', 2000);
  });
}

async function loadBidenPortrait() {
  try {
    const filename = 'Joe_Biden_presidential_portrait.jpg';
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url&iiurlwidth=200&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    const pages = data.query.pages;
    const page = Object.values(pages)[0];
    const thumbUrl = page?.imageinfo?.[0]?.thumburl;
    if (thumbUrl) {
      const portrait = document.getElementById('bidenPortrait');
      const img = document.createElement('img');
      img.alt = 'President Joe Biden';
      img.src = thumbUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:top center;display:block;';
      portrait.innerHTML = '';
      portrait.appendChild(img);
    }
  } catch (e) {
    // fallback initials remain
  }
}

// Handle enter key
document.getElementById('nameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') startSearch();
});

// On load, check hash and auto-search
window.addEventListener('load', () => {
  loadBidenPortrait();
  const hash = window.location.hash.replace('#', '').trim();
  if (hash) {
    if (/^Q\d+$/i.test(hash)) {
      loadEntity(hash.toUpperCase(), '');
    } else {
      // legacy name-based hash fallback
      const name = hash.replace(/-/g, ' ');
      document.getElementById('nameInput').value = name;
      startSearch();
    }
  }
});
