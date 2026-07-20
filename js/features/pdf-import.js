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

  // Mobile month view: for the current month, show today and upcoming dates only.
  // Desktop and other months remain unchanged.
  const mobileStyle = document.createElement('style');
  mobileStyle.textContent = '@media(max-width:640px){.day.mobile-past-date{display:none!important}.day.today{outline:2px solid var(--accent);box-shadow:0 0 0 3px rgba(137,166,255,.12)}}';
  document.head.appendChild(mobileStyle);

  function applyMobileCurrentDayView() {
    const calendar = $('calendar');
    if (!calendar) return;
    const now = new Date();
    const isMobile = window.matchMedia('(max-width:640px)').matches;
    const isCurrentMonth = cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth();

    calendar.querySelectorAll('.day').forEach(day => day.classList.remove('mobile-past-date'));
    if (!isMobile || !isCurrentMonth) return;

    calendar.querySelectorAll('.day:not(.other)').forEach(day => {
      const dayNumber = Number(day.querySelector('.date-number')?.textContent || 0);
      if (dayNumber < now.getDate()) day.classList.add('mobile-past-date');
    });
  }

  const originalRender = render;
  render = function () {
    originalRender();
    applyMobileCurrentDayView();
  };

  window.addEventListener('resize', applyMobileCurrentDayView);
  applyMobileCurrentDayView();
})();