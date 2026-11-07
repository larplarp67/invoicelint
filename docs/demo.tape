# Terminal demo for the README, rendered with charmbracelet/vhs.
#
# Regenerate locally (needs vhs, and invoicelint on PATH):
#   pnpm build && npm install --global . && vhs docs/demo.tape
# or on GitHub: Actions -> "Demo GIF" -> Run workflow, then commit the artifact.

Output docs/demo.gif

Require invoicelint

Set Shell "bash"
Set FontSize 15
Set Width 1200
Set Height 720
Set Padding 24
Set TypingSpeed 35ms

Hide
Type "cd test/fixtures && clear"
Enter
Show

Type "# A complete $250 Ontario invoice, as UBL / Peppol XML"
Enter
Sleep 400ms
Type "invoicelint check valid/tier2-on-invoice-250.xml"
Enter
Sleep 2.5s

Type "# The same invoice with one GST/HST number digit mistyped"
Enter
Sleep 400ms
Type "invoicelint check invalid/06-registration-number-typo.json"
Enter
Sleep 4s

Type "echo exit code $?"
Enter
Sleep 3s
