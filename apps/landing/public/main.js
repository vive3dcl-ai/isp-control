(function () {
  var cfg = window.ISP_LANDING || {}
  var panelUrl = (cfg.panelUrl || '/').replace(/\/?$/, '/')

  ;['cta-panel', 'cta-bottom', 'nav-panel'].forEach(function (id) {
    var el = document.getElementById(id)
    if (el) el.setAttribute('href', panelUrl)
  })

  var year = document.getElementById('year')
  if (year) year.textContent = '© ' + new Date().getFullYear()
})()
