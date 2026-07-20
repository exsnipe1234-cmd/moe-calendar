(() => {
  const LEGACY_CALENDAR_URL = 'https://raw.githubusercontent.com/exsnipe1234-cmd/moe-calendar/5c3ca77a79d79454f7c8ab58f5ebcef99cc567a5/index.html';

  async function loadCalendar() {
    try {
      const response = await fetch(LEGACY_CALENDAR_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      let html = await response.text();
      html = html.replace(
        '</head>',
        '<link rel="stylesheet" href="css/styles.css?v=4">' +
        '</head>'
      );
      html = html.replace(
        '</body>',
        '<script src="js/features/pdf-import.js?v=1"><\/script>' +
        '<script src="js/features/ai-smart-update.js?v=4"><\/script>' +
        '</body>'
      );

      document.open();
      document.write(html);
      document.close();
    } catch (error) {
      document.body.textContent = `Unable to load the calendar: ${error.message}`;
    }
  }

  loadCalendar();
})();
