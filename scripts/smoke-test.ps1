<#
.SYNOPSIS
Post-release smoke test: runs the published invoicelint from npm the way a user would.

.DESCRIPTION
Run after `npm publish`, before announcing a release or giving a demo. Needs network access.

1. CLI with npx: --version, rules, then `check` on a valid invoice (base.json, copied from
   test/fixtures/valid/tier2-on-invoice-250.json), six broken copies generated from it (each
   changes one thing), a UBL invoice and a UBL credit note.
2. Library: `npm install invoicelint` in the same folder, then validate() from an ES module.

Each case is compared with the expected rule IDs (errors and warnings, exactly) and exit code.
Prints PASS/FAIL per case and a summary table, and exits 1 if any case fails (2 if the package
can't be found or installed).

Kept ASCII-only so Windows PowerShell 5.1 reads it correctly without a byte order mark.

.PARAMETER Version
npm version or dist-tag to test. Default: latest.

.PARAMETER Package
Path to a package tarball (from `pnpm pack`) to test instead of a version from npm, so a
release can be smoke-tested before it is published. Its version is read from the tarball,
and -Version is ignored. Everything else (cases, npx, npm install) is the same.

.PARAMETER Dir
Working folder, deleted and recreated. Its name must start with "invoicelint-smoke".
Default: C:\temp\invoicelint-smoke on Windows, <temp>/invoicelint-smoke elsewhere.

.EXAMPLE
corepack pnpm smoke

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1 -Version 0.1.0

.EXAMPLE
corepack pnpm pack; powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1 -Package invoicelint-0.2.0.tgz
#>
param(
  [string]$Version = 'latest',
  [string]$Dir = '',
  [string]$Package = ''
)

$ErrorActionPreference = 'Stop'
$onWindows = $env:OS -eq 'Windows_NT'
if ($Dir -eq '') {
  if ($onWindows) { $Dir = 'C:\temp\invoicelint-smoke' }
  else { $Dir = Join-Path ([System.IO.Path]::GetTempPath()) 'invoicelint-smoke' }
}
$npm = 'npm'
$npx = 'npx'
if ($onWindows) { $npm = 'npm.cmd'; $npx = 'npx.cmd' }

# Read the CLI's UTF-8 output (check marks) correctly, and keep colour codes out of it.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:NO_COLOR = '1'
if (Test-Path Env:FORCE_COLOR) { Remove-Item Env:FORCE_COLOR }

$CHECK = [string][char]0x2713   # check mark, as in "OK" lines
$SKIP = [string][char]0x2298    # circled slash, as in "SKIPPED" lines
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$utf8 = New-Object System.Text.UTF8Encoding $false
$repo = Split-Path -Parent $PSScriptRoot
$fixtures = [System.IO.Path]::Combine($repo, 'test', 'fixtures')

# --- results -------------------------------------------------------------------------------

$results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Case, [string]$Expected, [string]$Actual, [bool]$Pass) {
  $mark = if ($Pass) { 'PASS' } else { 'FAIL' }
  $results.Add([pscustomobject]@{ Result = $mark; Case = $Case; Expected = $Expected; Actual = $Actual })
  $color = if ($Pass) { 'Green' } else { 'Red' }
  Write-Host ('{0}  {1}' -f $mark, $Case) -ForegroundColor $color
  if (-not $Pass) {
    Write-Host "      expected: $Expected"
    Write-Host "      actual:   $Actual"
  }
}

function Invoke-Cli([string[]]$CliArgs) {
  if ($script:fromTarball) { $out = & $npx --yes --package $script:pkg invoicelint @CliArgs }
  else { $out = & $npx --yes $script:pkg @CliArgs }
  [pscustomobject]@{ Text = (@($out) -join "`n"); Exit = $LASTEXITCODE }
}

function Format-Ids($Issues) {
  '[' + ((@($Issues) | Where-Object { $_ } | ForEach-Object { $_.ruleId }) -join ',') + ']'
}

# --- broken copies of base.json --------------------------------------------------------------

function Dec([string]$s) { [decimal]::Parse($s, $inv) }
function Money([decimal]$d) { $d.ToString('0.00', $inv) }
function Round2([decimal]$d) { [decimal]::Round($d, 2, [System.MidpointRounding]::AwayFromZero) }

function Write-Variant([string]$Name, [string]$Comment, [scriptblock]$Change) {
  $i = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'base.json') | ConvertFrom-Json
  $i | Add-Member -NotePropertyName '$comment' -NotePropertyValue $Comment -Force
  & $Change $i
  [System.IO.File]::WriteAllText((Join-Path $Dir $Name), ($i | ConvertTo-Json -Depth 10) + "`n", $utf8)
}

function Write-Variants {
  Write-Variant 'bad-bn.json' 'base.json with one digit of the GST/HST number changed.' {
    param($i)
    $bn = [string]$i.supplier.gstHstNumber
    $digit = [int]::Parse($bn.Substring(8, 1))
    $i.supplier.gstHstNumber = $bn.Substring(0, 8) + (($digit + 1) % 10) + $bn.Substring(9)
  }
  Write-Variant 'no-bn.json' 'base.json without the GST/HST number (total stays $100+).' {
    param($i)
    [void]$i.supplier.PSObject.Properties.Remove('gstHstNumber')
  }
  Write-Variant 'bad-total.json' 'base.json with the total $1.00 too high.' {
    param($i)
    $i.total = Money ((Dec $i.total) + 1)
  }
  Write-Variant 'gst7.json' 'base.json taxed as GST at 7%; tax and total adjusted so the math adds up.' {
    param($i)
    $sub = Dec $i.subtotal
    $tax = Round2 ($sub * [decimal]'0.07')
    $i.taxes = @([pscustomobject]@{ type = 'GST'; rate = 7; taxableAmount = (Money $sub); amount = (Money $tax) })
    $i.total = Money ($sub + $tax)
  }
  Write-Variant 'tier3-no-buyer.json' 'base.json scaled x3 to a $500+ total, no buyer; terms of payment added so only the buyer is missing.' {
    param($i)
    foreach ($line in $i.lines) {
      $line.quantity = [int]$line.quantity * 3
      $line.lineTotal = Money ((Dec $line.lineTotal) * 3)
    }
    $sub = (Dec $i.subtotal) * 3
    $first = $i.taxes[0]
    $tax = Round2 ($sub * [decimal]$first.rate / 100)
    $i.subtotal = Money $sub
    $i.taxes = @([pscustomobject]@{ type = $first.type; rate = $first.rate; taxableAmount = (Money $sub); amount = (Money $tax) })
    $i.total = Money ($sub + $tax)
    $i | Add-Member -NotePropertyName paymentTerms -NotePropertyValue 'Net 30' -Force
    [void]$i.PSObject.Properties.Remove('buyer')
  }
  Write-Variant 'usd.json' 'base.json in US dollars.' {
    param($i)
    $i.currency = 'USD'
  }
}

# --- cases -----------------------------------------------------------------------------------

# Errors and warnings must match exactly, so "no other rule fires" is checked too.
$checkCases = @(
  @{ Case = 'base.json'; File = 'base.json'; Status = 'ok'; Errors = ''; Warnings = ''; Exit = 0 },
  @{ Case = 'bad-bn.json'; File = 'bad-bn.json'; Status = 'failed'; Errors = 'CA-BN-001'; Warnings = ''; Exit = 1 },
  @{ Case = 'no-bn.json'; File = 'no-bn.json'; Status = 'ok'; Errors = ''; Warnings = 'CA-ITC-010'; Exit = 0 },
  @{ Case = 'no-bn.json --strict'; File = 'no-bn.json'; Extra = @('--strict'); Status = 'failed'; Errors = ''; Warnings = 'CA-ITC-010'; Exit = 1 },
  @{ Case = 'bad-total.json'; File = 'bad-total.json'; Status = 'failed'; Errors = 'CA-MATH-002'; Warnings = ''; Exit = 1 },
  @{ Case = 'gst7.json'; File = 'gst7.json'; Status = 'failed'; Errors = 'CA-RATE-001'; Warnings = ''; Exit = 1 },
  @{ Case = 'tier3-no-buyer.json'; File = 'tier3-no-buyer.json'; Status = 'ok'; Errors = ''; Warnings = 'CA-ITC-020'; Exit = 0 },
  @{ Case = 'usd.json'; File = 'usd.json'; Status = 'ok'; Errors = ''; Warnings = 'CA-CUR-001'; Exit = 0 },
  @{ Case = 'ubl.xml (UBL invoice)'; File = 'ubl.xml'; Status = 'ok'; Errors = ''; Warnings = ''; Exit = 0 },
  @{ Case = 'credit-note.xml (UBL credit note)'; File = 'credit-note.xml'; Status = 'skipped'; Errors = ''; Warnings = ''; Exit = 0 }
)
$prettyCases = @(
  @{ Case = 'base.json (pretty)'; File = 'base.json'; Expect = "$CHECK OK"; Exit = 0 },
  @{ Case = 'credit-note.xml (pretty)'; File = 'credit-note.xml'; Expect = "$SKIP SKIPPED"; Exit = 0 }
)

$testMjs = @'
import { readFileSync } from 'node:fs';
import { validate } from 'invoicelint';

for (const file of ['base.json', 'bad-bn.json']) {
  const report = validate(readFileSync(file, 'utf8'));
  const ids = (issues) => `[${issues.map((i) => i.ruleId).join(',')}]`;
  console.log(
    `${file}  ok=${report.ok}  errors=${ids(report.errors)}  warnings=${ids(report.warnings)}  infos=${ids(report.infos)}`,
  );
}
'@
$libraryCases = @(
  @{ Case = 'library: validate(base.json)'; Expected = 'base.json  ok=true  errors=[]  warnings=[]' },
  @{ Case = 'library: validate(bad-bn.json)'; Expected = 'bad-bn.json  ok=false  errors=[CA-BN-001]  warnings=[]' }
)

# --- run -------------------------------------------------------------------------------------

$script:fromTarball = $Package -ne ''
if ($script:fromTarball) {
  if (-not (Test-Path -PathType Leaf $Package)) {
    Write-Host "Package tarball '$Package' was not found." -ForegroundColor Red
    exit 2
  }
  $Package = (Resolve-Path $Package).Path
  $manifest = @(& tar -xOf $Package package/package.json) -join "`n"
  if ($LASTEXITCODE -ne 0 -or -not $manifest) {
    Write-Host "Could not read package/package.json from '$Package'." -ForegroundColor Red
    exit 2
  }
  $resolved = [string]($manifest | ConvertFrom-Json).version
  # npx caches by package spec, so a rebuilt tarball at the same path could run a stale
  # install. Name the copy after its content.
  $hash = (Get-FileHash -Algorithm SHA256 $Package).Hash.Substring(0, 12).ToLowerInvariant()
  $tarballName = "invoicelint-$resolved-$hash.tgz"
  $label = "invoicelint@$resolved from $Package"
} else {
  $resolved = @(& $npm view "invoicelint@$Version" version) | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0 -or -not $resolved) {
    Write-Host "invoicelint@$Version was not found on npm." -ForegroundColor Red
    exit 2
  }
  $resolved = $resolved.Trim()
  $script:pkg = "invoicelint@$resolved"
  $label = "$script:pkg (requested: $Version)"
}

if ((Split-Path -Leaf $Dir) -notlike 'invoicelint-smoke*') {
  Write-Host "Refusing to delete '$Dir': the folder name must start with invoicelint-smoke." -ForegroundColor Red
  exit 2
}
if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
New-Item -ItemType Directory -Force $Dir | Out-Null
if ($script:fromTarball) {
  $script:pkg = Join-Path $Dir $tarballName
  Copy-Item $Package $script:pkg
}

Write-Host "invoicelint smoke test: $label in $Dir"
Write-Host ''

$exitCode = 0
Push-Location $Dir
try {
  Copy-Item ([System.IO.Path]::Combine($fixtures, 'valid', 'tier2-on-invoice-250.json')) 'base.json'
  Copy-Item ([System.IO.Path]::Combine($fixtures, 'valid', 'tier2-on-invoice-250.xml')) 'ubl.xml'
  Copy-Item ([System.IO.Path]::Combine($fixtures, 'eu', 'fr-credit-note.xml')) 'credit-note.xml'
  Write-Variants

  # 1. CLI from npm
  $r = Invoke-Cli @('--version')
  Add-Result '--version' "$resolved, exit 0" ("{0}, exit {1}" -f $r.Text.Trim(), $r.Exit) ($r.Text.Trim() -eq $resolved -and $r.Exit -eq 0)

  $r = Invoke-Cli @('rules')
  $listed = @($r.Text -split "`n" | Where-Object { $_ -match '^CA-' }).Count
  $needed = @('CA-BN-001', 'CA-ITC-010', 'CA-MATH-002', 'CA-RATE-001', 'CA-ITC-020', 'CA-CUR-001')
  $missing = @($needed | Where-Object { $r.Text -notmatch "(?m)^$_\s" })
  $actual = "$listed rules listed, " + $(if ($missing.Count -eq 0) { 'all 6 present' } else { 'missing ' + ($missing -join ', ') }) + ", exit $($r.Exit)"
  Add-Result 'rules' 'lists the 6 rule IDs tested below, exit 0' $actual ($missing.Count -eq 0 -and $r.Exit -eq 0)

  foreach ($c in $prettyCases) {
    $r = Invoke-Cli @('check', '--format', 'pretty', $c.File)
    $first = ($r.Text -split "`n")[0]
    $pass = $first.Contains($c.Expect) -and $r.Exit -eq $c.Exit
    Add-Result $c.Case ('"{0}", exit {1}' -f $c.Expect, $c.Exit) ('"{0}", exit {1}' -f $first.Trim(), $r.Exit) $pass
  }

  foreach ($c in $checkCases) {
    $cliArgs = @('check', '--format', 'json')
    if ($c.Extra) { $cliArgs += $c.Extra }
    $cliArgs += $c.File
    $r = Invoke-Cli $cliArgs
    $expected = 'status={0} errors=[{1}] warnings=[{2}], exit {3}' -f $c.Status, $c.Errors, $c.Warnings, $c.Exit
    try {
      $f = ($r.Text | ConvertFrom-Json).files[0]
      $actual = 'status={0} errors={1} warnings={2}, exit {3}' -f $f.status, (Format-Ids $f.errors), (Format-Ids $f.warnings), $r.Exit
    } catch {
      $actual = "output is not JSON, exit $($r.Exit)"
    }
    Add-Result $c.Case $expected $actual ($actual -eq $expected)
  }

  $r = Invoke-Cli @('check', '--format', 'json', 'bad-bn.json')
  try {
    $doc = $r.Text | ConvertFrom-Json
    $actual = 'parses; schemaVersion={0}, tool.version={1}' -f $doc.schemaVersion, $doc.tool.version
  } catch {
    $actual = 'does not parse: ' + $_.Exception.Message
  }
  Add-Result 'bad-bn.json --format json' "parses; schemaVersion=1, tool.version=$resolved" $actual ($actual -eq "parses; schemaVersion=1, tool.version=$resolved")

  # 2. Library from npm
  & $npm init -y | Out-Null
  & $npm install --no-audit --no-fund $script:pkg | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Add-Result 'library: npm install' "$script:pkg installs" "npm install failed (exit $LASTEXITCODE)" $false
  } else {
    [System.IO.File]::WriteAllText((Join-Path $Dir 'test.mjs'), $testMjs, $utf8)
    $lines = @(& node test.mjs)
    $nodeExit = $LASTEXITCODE
    foreach ($c in $libraryCases) {
      $line = @($lines | Where-Object { $_.StartsWith($c.Expected.Split(' ')[0] + ' ') }) | Select-Object -First 1
      if (-not $line) { $line = "(no output line; node exit $nodeExit)" }
      Add-Result $c.Case $c.Expected $line.Trim() ($line.StartsWith($c.Expected))
    }
  }
} catch {
  Add-Result 'smoke test run' 'completes' ('stopped: ' + $_.Exception.Message) $false
} finally {
  Pop-Location
}

$failed = @($results | Where-Object { $_.Result -eq 'FAIL' }).Count
Write-Host ''
$results | Format-Table Result, Case, Expected, Actual -AutoSize -Wrap | Out-String -Width 220 | Write-Host
Write-Host ('{0} cases: {1} passed, {2} failed ({3}, {4})' -f $results.Count, ($results.Count - $failed), $failed, $label, $Dir)
if ($failed -gt 0) { $exitCode = 1 }
exit $exitCode
