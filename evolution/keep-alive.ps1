<#
.SYNOPSIS
    Vérifie — et, avec -Apply, met en place — ce qui rend le poste apte à héberger
    la passerelle WhatsApp en service continu.

.DESCRIPTION
    LA CONTREPARTIE, DITE FRANCHEMENT
    Ce montage ne loue aucun serveur. C'est donc CE POSTE qui tient la session
    WhatsApp ouverte. Éteint, en veille, ou sans Internet ⇒ AUCUN message ne
    part, et personne n'est prévenu automatiquement. Les envois sont mis en
    attente par l'application et repartent seuls au retour — mais rien ne part
    tant que le poste dort.

    Ce script supprime les causes ÉVITABLES de cette panne :

      1. la mise en veille et la veille prolongée. Elles suspendent les
         conteneurs et font tomber la session : c'est la cause n°1 d'un service
         qui « marche la journée et plus le soir » ;
      2. le démarrage automatique du moteur Docker. Après une coupure de
         courant, la politique `unless-stopped` ne sert à rien tant que Docker
         Desktop n'est pas lancé ;
      3. l'état et la politique de redémarrage des trois conteneurs ;
      4. un montage CONCURRENT qui partagerait les mêmes volumes.

    Il ne peut rien contre un poste débranché.

    IL NE SIGNALE QUE CE QUI CASSE RÉELLEMENT LE SERVICE. L'arrêt des disques
    inactifs, par exemple, n'est pas signalé : le disque se réveille au premier
    accès, cela ne coupe rien. Un faux signalement apprend à ignorer le rapport.

.PARAMETER Apply
    Applique les corrections. Sans ce commutateur, le script se contente de
    rapporter — il ne modifie rien.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1
    powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1 -Apply
#>
[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Continue'
$script:Problems = 0

function Write-Head($text) {
  Write-Host ''
  Write-Host "=== $text " -ForegroundColor Cyan
}
function Write-Ok($text)    { Write-Host "  [OK]  $text" -ForegroundColor Green }
function Write-Bad($text)   { Write-Host "  [KO]  $text" -ForegroundColor Red;    $script:Problems++ }
function Write-Warn($text)  { Write-Host "  [!]   $text" -ForegroundColor Yellow }
function Write-Fix($text)   { Write-Host "        -> $text" -ForegroundColor DarkGray }

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host ''
Write-Host '  PASSERELLE WHATSAPP — APTITUDE DU POSTE AU SERVICE CONTINU' -ForegroundColor White
if ($Apply -and -not $isAdmin) {
  Write-Warn 'Ce script n''est pas lance en administrateur : les corrections d''alimentation echoueront.'
}
if (-not $Apply) {
  Write-Host '  Mode RAPPORT — rien ne sera modifie. Relancez avec -Apply pour corriger.' -ForegroundColor DarkGray
}

# =====================================================================================
#  1. VEILLE ET VEILLE PROLONGEE
#     Elles suspendent les conteneurs. La session WhatsApp tombe, et rien ne
#     signale qu'elle est tombee.
# =====================================================================================
Write-Head '1. Mise en veille'

function Get-SleepTimeout($subGuid, $settingGuid) {
  # `powercfg /q` rend la valeur en hexadecimal ; 0 = jamais.
  $out = powercfg /q SCHEME_CURRENT $subGuid $settingGuid 2>$null
  $line = $out | Select-String 'Index de param.tres actuel du secteur|Current AC Power Setting Index'
  if (-not $line) { return $null }
  $hex = ($line -split ':')[-1].Trim()
  try { return [Convert]::ToInt32($hex, 16) } catch { return $null }
}

$SUB_SLEEP  = '238C9FA8-0AAD-41ED-83F4-97BE242C8F20'
$STANDBY    = '29F6C1DB-86DA-48C5-9FDB-F2B67B1F44DA'   # mise en veille
$HIBERNATE  = '9D7815A6-7EE4-497E-8888-515A05F02364'   # veille prolongee

$standby   = Get-SleepTimeout $SUB_SLEEP $STANDBY
$hibernate = Get-SleepTimeout $SUB_SLEEP $HIBERNATE

foreach ($item in @(
  @{ Name = 'Mise en veille';    Value = $standby;   Guid = $STANDBY;   Flag = 'standby-timeout-ac' },
  @{ Name = 'Veille prolongee';  Value = $hibernate; Guid = $HIBERNATE; Flag = 'hibernate-timeout-ac' }
)) {
  if ($null -eq $item.Value) {
    Write-Warn "$($item.Name) : valeur illisible sur ce poste."
  } elseif ($item.Value -eq 0) {
    Write-Ok "$($item.Name) : jamais."
  } else {
    Write-Bad "$($item.Name) : apres $($item.Value) minutes — la session WhatsApp tombera."
    if ($Apply) {
      powercfg /change $item.Flag 0 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Fix 'Corrige : jamais.' } else { Write-Fix 'Echec — relancez en administrateur.' }
    } else {
      Write-Fix "powercfg /change $($item.Flag) 0"
    }
  }
}

# =====================================================================================
#  2. DEMARRAGE AUTOMATIQUE DE DOCKER
#     Apres une coupure de courant, `unless-stopped` ne s'applique qu'une fois le
#     moteur lance. Sans ce demarrage automatique, rien ne repart.
# =====================================================================================
Write-Head '2. Demarrage automatique de Docker Desktop'

$startupLink = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Docker Desktop.lnk'
$dockerExe   = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$runKey      = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$hasRunKey   = $false
try {
  $props = Get-ItemProperty -Path $runKey -ErrorAction Stop
  $hasRunKey = ($props.PSObject.Properties.Name -contains 'Docker Desktop')
} catch { }

if ((Test-Path $startupLink) -or $hasRunKey) {
  Write-Ok 'Docker Desktop demarre avec la session Windows.'
} elseif (-not (Test-Path $dockerExe)) {
  Write-Bad 'Docker Desktop est introuvable sur ce poste.'
  Write-Fix 'Installez Docker Desktop (Windows 10/11 + WSL2), puis relancez ce script.'
} else {
  Write-Bad 'Docker Desktop ne demarre PAS automatiquement : apres une coupure, rien ne repart.'
  if ($Apply) {
    try {
      $ws = New-Object -ComObject WScript.Shell
      $lnk = $ws.CreateShortcut($startupLink)
      $lnk.TargetPath = $dockerExe
      $lnk.Save()
      Write-Fix 'Raccourci de demarrage cree.'
    } catch {
      Write-Fix "Echec : $($_.Exception.Message)"
    }
  } else {
    Write-Fix 'Relancez avec -Apply, ou activez « Start Docker Desktop when you sign in » dans ses reglages.'
  }
}

# =====================================================================================
#  3. LES CONTENEURS
# =====================================================================================
Write-Head '3. Conteneurs de la passerelle'

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Bad 'La commande `docker` est introuvable : impossible de verifier les conteneurs.'
} else {
  $expected = @('rclmc-wa-evolution', 'rclmc-wa-postgres', 'rclmc-wa-tailscale')
  foreach ($name in $expected) {
    $state = (docker inspect -f '{{.State.Status}}|{{.HostConfig.RestartPolicy.Name}}' $name 2>$null)
    if (-not $state) {
      Write-Bad "$name : conteneur absent."
      Write-Fix 'docker compose -f evolution/docker-compose.funnel.yml up -d'
      continue
    }
    $parts = $state -split '\|'
    $status = $parts[0]; $policy = $parts[1]
    if ($status -ne 'running') {
      Write-Bad "$name : $status."
      Write-Fix 'docker compose -f evolution/docker-compose.funnel.yml up -d'
    } elseif ($policy -ne 'unless-stopped' -and $policy -ne 'always') {
      Write-Bad "$name : demarre, mais politique de redemarrage « $policy » — il ne reviendra pas apres un redemarrage."
      Write-Fix "docker update --restart unless-stopped $name"
      if ($Apply) { docker update --restart unless-stopped $name 2>$null | Out-Null; Write-Fix 'Corrige.' }
    } else {
      Write-Ok "$name : en marche ($policy)."
    }
  }

  # ── 4. Montage concurrent ──────────────────────────────────────────────────
  #    Deux fichiers compose du meme dossier resolvent le MEME nom de projet,
  #    donc les MEMES volumes. Les demarrer ensemble met deux passerelles et deux
  #    bases sur les memes donnees.
  Write-Head '4. Montage concurrent'
  $others = docker ps --format '{{.Names}}' 2>$null |
            Where-Object { $_ -match 'evolution' -and $_ -notmatch '^rclmc-wa-' }
  if ($others) {
    Write-Bad 'Un autre montage Evolution tourne sur ce poste :'
    $others | ForEach-Object { Write-Fix $_ }
    Write-Fix 'Arretez-le : deux passerelles sur les memes volumes corrompent la session.'
  } else {
    Write-Ok 'Aucun montage concurrent.'
  }
}

# =====================================================================================
#  5. CE QUI EST SIGNALE SANS ETRE MODIFIE
#     Ces deux reglages engagent une decision qui n'appartient pas a un script.
# =====================================================================================
Write-Head '5. A decider a la main (non modifie par ce script)'

$autoLogon = $null
try {
  $autoLogon = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction Stop).AutoAdminLogon
} catch { }
if ($autoLogon -eq '1') {
  Write-Ok 'Ouverture de session automatique active : le poste repart seul apres une coupure.'
} else {
  Write-Warn 'Ouverture de session automatique INACTIVE.'
  Write-Fix 'Sans elle, apres une coupure de courant Windows s''arrete sur l''ecran de connexion'
  Write-Fix 'et Docker ne demarre jamais. L''activer STOCKE UN MOT DE PASSE : a ne faire que si'
  Write-Fix 'le poste est protege physiquement.'
}

Write-Warn 'Heures d''activite de Windows Update : a regler hors des heures d''ouverture,'
Write-Fix 'pour qu''un redemarrage automatique ne tombe pas en pleine journee.'
Write-Fix 'Parametres -> Windows Update -> Heures d''activite.'

# =====================================================================================
Write-Host ''
if ($script:Problems -eq 0) {
  Write-Host '  RESULTAT : le poste est apte au service continu.' -ForegroundColor Green
} else {
  Write-Host "  RESULTAT : $($script:Problems) point(s) a corriger." -ForegroundColor Red
  if (-not $Apply) { Write-Host '  Relancez en administrateur avec -Apply.' -ForegroundColor Yellow }
}
Write-Host ''
Write-Host '  RAPPEL : poste eteint = aucun message ne part, et personne n''est prevenu.' -ForegroundColor DarkGray
Write-Host ''
