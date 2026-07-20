(() => {
  const normalise = value => String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  function teacherByName(name) {
    const wanted = normalise(name);
    return profiles.find(person => normalise(person.display_name) === wanted) || null;
  }

  async function askCalendarAI(message) {
    const { data, error } = await sb.functions.invoke('calendar-ai', { body: { message } });
    if (error) {
      let text = error.message || 'AI request failed.';
      try {
        const details = await error.context.json();
        text = details.error || text;
      } catch (_) {}
      throw new Error(text);
    }
    if (!data?.result) throw new Error('The AI returned no calendar instruction.');
    return data.result;
  }

  const title = document.querySelector('#smartDialog h2');
  const intro = document.querySelector('#smartDialog > .muted');
  if (title) title.textContent = 'Music Delight AI';
  if (intro) intro.textContent = 'Describe a new lesson in normal English. AI will prepare a preview before it is added.';

  $('smartBtn').onclick = () => {
    $('smartCommand').value = '';
    $('smartPreview').classList.add('hidden');
    $('smartConfirm').classList.add('hidden');
    $('smartError').textContent = '';
    $('smartParse').textContent = 'Ask AI';
    $('smartDialog').showModal();
  };

  $('smartCommand').oninput = () => {};

  $('smartParse').onclick = async () => {
    const message = $('smartCommand').value.trim();
    if (!message) return $('smartError').textContent = 'Enter a calendar instruction.';
    $('smartError').textContent = '';
    $('smartConfirm').classList.add('hidden');
    $('smartParse').disabled = true;
    $('smartParse').textContent = 'Thinking…';
    try {
      const result = await askCalendarAI(message);
      if (result.action === 'clarification') {
        $('smartError').textContent = result.clarification_question || 'Please provide more details.';
        return;
      }
      if (result.action !== 'add') throw new Error('The first AI version supports adding lessons. Editing and searching will be added next.');
      const teacher = teacherByName(result.teacher);
      if (!teacher) throw new Error('Teacher not found in the calendar.');
      if (!result.date || !result.start_time || !result.end_time || !result.school || !result.activity) throw new Error('The AI response is missing lesson details.');
      const payload = {
        teacher_id: teacher.id,
        lesson_date: result.date,
        start_time: result.start_time,
        end_time: result.end_time,
        school: result.school,
        class_name: result.class_name || null,
        activity: result.activity,
        status: 'Confirmed',
        notes: 'Added through Music Delight AI',
        created_by: session.user.id
      };
      smartActions = [{ payload }];
      $('smartPreview').innerHTML = `<div class="preview-item"><b>Add lesson</b><br>${esc(teacher.display_name)} · ${esc(result.date)} · ${esc(result.start_time)}–${esc(result.end_time)}<br>${esc(result.school)}${result.class_name ? ' · ' + esc(result.class_name) : ''} · ${esc(result.activity)}</div><div class="preview-item">${esc(result.confirmation_message)}</div>`;
      $('smartPreview').classList.remove('hidden');
      $('smartConfirm').textContent = 'Confirm add';
      $('smartConfirm').classList.remove('hidden');
    } catch (error) {
      $('smartError').textContent = error.message;
    } finally {
      $('smartParse').disabled = false;
      $('smartParse').textContent = 'Ask AI';
    }
  };

  $('smartConfirm').onclick = async () => {
    const payload = smartActions[0]?.payload;
    if (!payload) return;
    busy(true);
    const response = await sb.from('lessons').insert(payload);
    busy(false);
    if (response.error) return $('smartError').textContent = response.error.message;
    $('smartDialog').close();
    toast('AI lesson added.');
    await loadLessons();
  };
})();
