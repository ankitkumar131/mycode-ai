#!/bin/sh
node --test >/dev/null 2>&1 || exit 1
node -e "import('./src/signup.js').then(m => {
  const bad = [ {}, {email:'x'}, {email:'a@b.co'}, {email:'a@b.co',password:'short'} ];
  for (const input of bad) { let threw=false; try { m.signup(input); } catch (e) { threw = e instanceof TypeError; } if (!threw) { console.error('no TypeError for', JSON.stringify(input)); process.exit(1); } }
  if (m.signup({email:'a@b.co',password:'longenough'}).ok !== true) process.exit(1);
})" || exit 1
exit 0
