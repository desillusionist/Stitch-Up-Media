// The one line of the app menu that is ours: CHECK FOR UPDATES…, directly below About.
//
// It is checked in a bare Electron process rather than in the app, because the app's own menu is native and
// cannot be read back from a renderer — and because the running app must not be restarted to find out. What this
// asserts is the contract main.ts relies on: that macOS's DEFAULT menu is there to be edited (rather than absent
// on some future Electron), that inserting at index 1 lands under About, and that everything else survives.
const { app, Menu, MenuItem } = require('electron')

const problems = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       ${detail}`}`)
  if (!ok) problems.push(label)
}

app.whenReady().then(() => {
  const menu = Menu.getApplicationMenu()
  check('a default application menu exists to edit', Boolean(menu), 'Menu.getApplicationMenu() answered null')
  const submenu = menu?.items?.[0]?.submenu
  check('and its first submenu is the app menu', Boolean(submenu), JSON.stringify(menu?.items?.map((item) => item.label)))

  const before = submenu ? submenu.items.map((item) => item.label) : []
  if (submenu) {
    submenu.insert(1, new MenuItem({ id: 'check-for-updates', label: 'Check for Updates…', click: () => {} }))
    const after = submenu.items.map((item) => item.label)
    console.log(`  app menu: ${after.join(' | ')}`)
    check('the check sits directly below About', after[1] === 'Check for Updates…', JSON.stringify(after))
    check('About is still first', /About/i.test(after[0] || ''), String(after[0]))
    check('and nothing else was displaced', after.length === before.length + 1, `${before.length} before, ${after.length} after`)
    check('it carries the id the app asks for', submenu.items[1]?.id === 'check-for-updates', String(submenu.items[1]?.id))
  }

  // The Edit menu is why this EDITS the default rather than replacing it: the text fields in the app paste with
  // its items, and a hand-built menu would have to reproduce all of them to add one line.
  const labels = (menu?.items || []).map((item) => item.label)
  check('the Edit menu is still there for the fields', labels.some((label) => /Edit/i.test(label || '')), JSON.stringify(labels))

  console.log(problems.length ? `\n${problems.length} MENU PROBLEM(S)\n` : '\nTHE APP MENU CARRIES THE UPDATE CHECK UNDER ABOUT\n')
  app.exit(problems.length ? 1 : 0)
})
