// The two lines of the app menu that are ours: the NAME the menu reads, and CHECK FOR UPDATES… under About.
//
// It is checked in a bare Electron process rather than in the app, because the app's own menu is native and cannot
// be read back from a renderer — and because the running app must not be restarted to find out. What this asserts is
// the contract main.ts relies on: that the menu's About line follows `app.setName` (Electron does not read
// electron-builder's `productName`, which is how the menu came to say "About stitch-up-media"), that inserting at index
// 1 lands under About, and that re-installing the menu is what a NEW menu needs to be drawn at all.
const { app, Menu, MenuItem } = require('electron')

// The same call main.ts makes, before the app is ready — which is the point: the default menu is built with it.
app.setName('Stitch Up Media')

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
  if (!menu || !submenu) {
    console.log('\nNO APP MENU\n')
    app.exit(1)
    return
  }

  const before = submenu.items.map((item) => item.label)
  console.log(`  app menu before: ${before.join(' | ')}`)
  // The name reaches the menu: About, Hide and Quit all follow `app.name`.
  check('the About line carries the product name, not the package name', before[0] === 'About Stitch Up Media', String(before[0]))
  check('and so does Quit', before.some((label) => label === 'Quit Stitch Up Media'), JSON.stringify(before))

  submenu.insert(1, new MenuItem({ id: 'check-for-updates', label: 'Check for Updates…', click: () => {} }))
  const after = submenu.items.map((item) => item.label)
  console.log(`  app menu after:  ${after.join(' | ')}`)
  check('the check sits directly below About', after[1] === 'Check for Updates…', JSON.stringify(after))
  check('About is still first', /^About /.test(after[0] || ''), String(after[0]))
  check('and nothing else was displaced', after.length === before.length + 1, `${before.length} before, ${after.length} after`)
  check('it carries the id the app asks for', submenu.items[1]?.id === 'check-for-updates', String(submenu.items[1]?.id))

  // What the app does after editing, and what the menu bar needs: the edited object has to be INSTALLED, or the
  // native menu keeps the one it was built with however correct Electron's own list looks.
  Menu.setApplicationMenu(menu)
  const installed = Menu.getApplicationMenu()?.items?.[0]?.submenu?.items?.map((item) => item.label) || []
  check('installing the edited menu keeps the item', installed[1] === 'Check for Updates…', JSON.stringify(installed))

  // The Edit menu is why this EDITS the default rather than replacing it: the text fields in the app paste with
  // its items, and a hand-built menu would have to reproduce all of them to add one line.
  const labels = (Menu.getApplicationMenu()?.items || []).map((item) => item.label)
  check('the Edit menu is still there for the fields', labels.some((label) => /Edit/i.test(label || '')), JSON.stringify(labels))

  console.log(problems.length ? `\n${problems.length} MENU PROBLEM(S)\n` : '\nTHE APP MENU CARRIES THE PRODUCT NAME AND THE UPDATE CHECK UNDER ABOUT\n')
  app.exit(problems.length ? 1 : 0)
})
