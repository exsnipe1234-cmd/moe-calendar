(() => {
  const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  function duplicateFor(row, teacher) {
    return lessons.find(item =>
      item.teacher_id === teacher?.id &&
      item.lesson_date === row.lesson_date &&
      item.start_time.slice(0, 5) === row.start_time &&
      item.end_time.slice(0, 5) === row.end_time &&
      norm(item.school) === norm(row.school)
    ) || null;
  }

  showPdfPreview = function () {
    const teacher = profiles.find(person => person.id === $('pdfTeacher').value);
    const activity = $('pdfActivity').value.trim() || teacher?.display_name || 'General';
    pdfRows = pdfRows.map(row => ({ ...row, duplicate: duplicateFor(row, teacher) }));
    const duplicateCount = pdfRows.filter(row => row.duplicate).length;

    $('pdfSummary').innerHTML = `<span>${pdfRows.length} detected</span><span>Teacher: ${esc(teacher?.display_name || 'Unknown')}</span><span>Fallback activity: ${esc(activity)}</span>${duplicateCount ? `<span style="background:#4b2730">${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} found</span>` : ''}`;
    $('pdfSummary').classList.remove('hidden');
    $('pdfPreview').innerHTML = '<table class="pdf-table"><thead><tr><th>Date</th><th>Time</th><th>Calendar text</th><th>Duplicate action</th></tr></thead><tbody>' + pdfRows.map((row, index) => `<tr style="${row.duplicate ? 'background:#4b2730' : ''}"><td>${esc(row.lesson_date)}</td><td>${esc(row.start_time)}–${esc(row.end_time)}</td><td>${esc(row.raw)}${row.duplicate ? '<div style="color:#ffb5c0;font-weight:700">Already exists in calendar</div>' : ''}</td><td>${row.duplicate ? `<label><input style="width:auto;margin-right:6px" type="checkbox" data-remove-duplicate="${index}">Remove existing and replace</label>` : '—'}</td></tr>`).join('') + '</tbody></table>';
    $('pdfPreview').classList.remove('hidden');
    $('pdfImport').classList.toggle('hidden', !pdfRows.length);
  };

  $('pdfImport').onclick = async () => {
    const teacher = profiles.find(person => person.id === $('pdfTeacher').value);
    if (!teacher) return $('pdfError').textContent = 'Choose a teacher.';

    const activity = $('pdfActivity').value.trim() || teacher.display_name;
    const replaceIndexes = [...document.querySelectorAll('[data-remove-duplicate]:checked')].map(input => Number(input.dataset.removeDuplicate));
    const removeIds = replaceIndexes.map(index => pdfRows[index]?.duplicate?.id).filter(Boolean);

    busy(true);
    if (removeIds.length) {
      const deleted = await sb.from('lessons').delete().in('id', removeIds);
      if (deleted.error) {
        busy(false);
        return $('pdfError').textContent = deleted.error.message;
      }
    }

    const rowsToAdd = pdfRows.filter((row, index) => !row.duplicate || replaceIndexes.includes(index));
    const payloads = rowsToAdd.map(row => ({
      teacher_id: teacher.id,
      lesson_date: row.lesson_date,
      start_time: row.start_time,
      end_time: row.end_time,
      school: row.school || 'Unspecified',
      class_name: null,
      activity,
      status: 'Confirmed',
      notes: 'PDF import: ' + row.raw,
      created_by: session.user.id
    }));

    let added = 0;
    for (let index = 0; index < payloads.length; index += 100) {
      const result = await sb.from('lessons').insert(payloads.slice(index, index + 100));
      if (result.error) {
        busy(false);
        return $('pdfError').textContent = result.error.message;
      }
      added += Math.min(100, payloads.length - index);
    }

    const skipped = pdfRows.filter((row, index) => row.duplicate && !replaceIndexes.includes(index)).length;
    busy(false);
    $('pdfDialog').close();
    toast(`${added} lessons imported${removeIds.length ? `, ${removeIds.length} duplicate${removeIds.length === 1 ? '' : 's'} replaced` : ''}${skipped ? `, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped` : ''}.`);
    await loadLessons();
  };

  // Daily schedule view. This is intentionally attached here so the stable,
  // self-contained calendar and authentication code do not need to be changed.
  let activeCalendarView = 'today';

  const style = document.createElement('style');
  style.textContent = `
    .today-schedule{display:grid;gap:12px}
    .today-heading{padding:18px;border-radius:15px}
    .today-heading h2{margin:0 0 5px;font-size:24px}
    .today-heading p{margin:0;color:var(--muted)}
    .today-lesson{display:grid;grid-template-columns:125px 1fr auto;gap:16px;align-items:center;padding:16px;border-radius:14px;cursor:pointer}
    .today-lesson:hover{filter:brightness(1.08)}
    .today-time{font-size:18px;font-weight:800}
    .today-school{font-size:17px;font-weight:750}
    .today-meta{margin-top:5px;color:var(--muted);font-size:13px}
    .today-teacher{padding:6px 10px;border-radius:999px;background:#233858;font-size:12px;white-space:nowrap}
    @media(max-width:640px){.today-lesson{grid-template-columns:1fr}.today-teacher{justify-self:start}}
  `;
  document.head.appendChild(style);

  const monthWrap = $('monthWrap');
  const listWrap = $('listWrap');
  const todayWrap = document.createElement('div');
  todayWrap.id = 'todayWrap';
  todayWrap.className = 'today-schedule';
  monthWrap.parentNode.insertBefore(todayWrap, monthWrap);

  const monthButton = $('monthViewBtn');
  const listButton = $('listViewBtn');
  const todayButton = document.createElement('button');
  todayButton.id = 'todayViewBtn';
  todayButton.className = 'btn primary';
  todayButton.textContent = 'Today';
  monthButton.parentNode.insertBefore(todayButton, monthButton);

  function localTodayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function setActiveButton(button) {
    [todayButton, monthButton, listButton].forEach(item => item.classList.remove('primary'));
    button.classList.add('primary');
  }

  function renderTodayView() {
    if (activeCalendarView !== 'today') return;
    const date = localTodayIso();
    const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-SG', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const items = filtered()
      .filter(item => item.lesson_date === date)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    todayWrap.innerHTML = `<section class="today-heading glass"><h2>${esc(dayLabel)}</h2><p>${items.length} lesson${items.length === 1 ? '' : 's'} scheduled today</p></section>` +
      (items.length
        ? items.map(item => {
            const person = profileById(item.teacher_id);
            return `<article class="today-lesson glass" data-id="${item.id}" style="border-left:4px solid ${esc(person.colour || person.color || '#89a6ff')}">
              <div class="today-time">${esc(item.start_time.slice(0, 5))}–${esc(item.end_time.slice(0, 5))}</div>
              <div><div class="today-school">${esc(item.school)}</div><div class="today-meta">${item.class_name ? esc(item.class_name) + ' · ' : ''}${esc(item.activity)} · ${esc(item.status)}</div></div>
              <div class="today-teacher">${esc(person.display_name)}</div>
            </article>`;
          }).join('')
        : '<div class="empty glass">No lessons scheduled for today.</div>');
    bindEvents();
  }

  function showToday() {
    activeCalendarView = 'today';
    todayWrap.classList.remove('hidden');
    monthWrap.classList.add('hidden');
    listWrap.classList.add('hidden');
    setActiveButton(todayButton);
    renderTodayView();
  }

  const originalRender = render;
  render = function () {
    originalRender();
    renderTodayView();
  };

  todayButton.onclick = showToday;
  monthButton.onclick = () => {
    activeCalendarView = 'month';
    todayWrap.classList.add('hidden');
    monthWrap.classList.remove('hidden');
    listWrap.classList.add('hidden');
    setActiveButton(monthButton);
  };
  listButton.onclick = () => {
    activeCalendarView = 'list';
    todayWrap.classList.add('hidden');
    monthWrap.classList.add('hidden');
    listWrap.classList.remove('hidden');
    setActiveButton(listButton);
  };

  showToday();
})();