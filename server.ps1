# ============================================================
#  OI-OPOLY LAN server - Windows PowerShell, zero dependency.
#  Usage: powershell -ExecutionPolicy Bypass -File server.ps1
#  Default port 8765, override with $env:PORT.
#  This file is intentionally ASCII-only so Windows PowerShell
#  5.1 can parse it under any code page.
# ============================================================

$ErrorActionPreference = 'Stop'
$Port = if ($env:PORT) { [int]$env:PORT } else { 8765 }
$Root = $PSScriptRoot
$MaxPlayers = 4
$Rooms = @{}

$Mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.gif'  = 'image/gif'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.map'  = 'application/json; charset=utf-8'
}

function Get-NowMs {
  return [int64](([DateTime]::UtcNow - [DateTime]'1970-01-01T00:00:00Z').TotalMilliseconds)
}

function Write-Log($text) {
  Write-Host ('[OI-LAN] ' + $text)
}

function New-Token {
  return [Guid]::NewGuid().ToString('N')
}

function Clean-Name($name) {
  $s = [string]$name
  $s = $s -replace '[\x00-\x1f<>]', ''
  $s = $s.Trim()
  if ($s.Length -gt 12) { $s = $s.Substring(0, 12) }
  if ($s.Length -eq 0) { $s = 'Player' }
  return $s
}

function Clean-Config($config) {
  $size = 40
  $difficulty = 'normal'
  $rounds = 25
  $count = 3
  if ($config) {
    $trySize = 0
    if ([int]::TryParse([string]$config.size, [ref]$trySize)) {
      if ($trySize -eq 40 -or $trySize -eq 72 -or $trySize -eq 96) { $size = $trySize }
    }
    if (@('easy', 'normal', 'hard') -contains [string]$config.difficulty) { $difficulty = [string]$config.difficulty }
    $tryRounds = 0
    if ([int]::TryParse([string]$config.rounds, [ref]$tryRounds)) {
      if ($tryRounds -eq 15 -or $tryRounds -eq 25 -or $tryRounds -eq 40) { $rounds = $tryRounds }
    }
    $tryCount = 0
    if ([int]::TryParse([string]$config.count, [ref]$tryCount)) {
      if ($tryCount -lt 2) { $tryCount = 2 }
      if ($tryCount -gt 4) { $tryCount = 4 }
      $count = $tryCount
    }
  }
  return @{ size = $size; difficulty = $difficulty; rounds = $rounds; count = $count }
}

function New-RoomCode {
  for ($i = 0; $i -lt 200; $i++) {
    $code = [string](Get-Random -Minimum 1000 -Maximum 10000)
    if (-not $Rooms.ContainsKey($code)) { return $code }
  }
  return [string](Get-Random -Minimum 100000 -Maximum 999999)
}

function Get-RoomView($room) {
  $now = Get-NowMs
  $players = New-Object System.Collections.ArrayList
  foreach ($key in $room.players.Keys) {
    $p = $room.players[$key]
    $connected = ($now - [int64]$p.lastSeen) -lt 22000
    [void]$players.Add(@{
      slot = [int]$key
      name = [string]$p.name
      host = ([int]$key -eq [int]$room.hostSlot)
      connected = $connected
    })
  }
  $sorted = @($players | Sort-Object { $_.slot })
  return @{
    code = $room.code
    hostSlot = $room.hostSlot
    started = $room.started
    config = $room.config
    players = $sorted
    maxPlayers = $MaxPlayers
    createdAt = $room.createdAt
  }
}

function Push-Message($room, $message) {
  $message['i'] = [int]$room.nextIndex
  $message['at'] = Get-NowMs
  $room.nextIndex = [int]$room.nextIndex + 1
  [void]$room.messages.Add($message)
  try {
    $raw = ConvertTo-Json -InputObject $message -Depth 40 -Compress
    $room.bytes = [int]$room.bytes + $raw.Length
  } catch {
    $room.bytes = 0
  }
  while ($room.messages.Count -gt 700 -or $room.bytes -gt 3145728) {
    if ($room.messages.Count -eq 0) { break }
    $removed = $room.messages[0]
    $room.messages.RemoveAt(0)
    try {
      $raw2 = ConvertTo-Json -InputObject $removed -Depth 40 -Compress
      $room.bytes = [int]$room.bytes - $raw2.Length
    } catch {
      $room.bytes = 0
    }
    if ($room.bytes -lt 0) { $room.bytes = 0 }
  }
  $room.lastActivity = Get-NowMs
  return $message
}

function Push-Room($room) {
  return Push-Message $room @{ type = 'room'; payload = (Get-RoomView $room) }
}

function Push-System($room, $text) {
  return Push-Message $room @{ type = 'chat'; from = -1; fromName = 'lan'; payload = @{ text = $text } }
}

# ---------------- HTTP plumbing ----------------
function Read-Request($stream) {
  $buffer = New-Object byte[] 16384
  $ms = New-Object System.IO.MemoryStream
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    $n = $stream.Read($buffer, 0, $buffer.Length)
    if ($n -le 0) { return $null }
    $ms.Write($buffer, 0, $n)
    $arr = $ms.ToArray()
    for ($i = 0; $i -le ($arr.Length - 4); $i++) {
      if ($arr[$i] -eq 13 -and $arr[$i + 1] -eq 10 -and $arr[$i + 2] -eq 13 -and $arr[$i + 3] -eq 10) {
        $headerEnd = $i
        break
      }
    }
    if ($ms.Length -gt 131072) { return $null }
  }
  $all = $ms.ToArray()
  $headerText = [System.Text.Encoding]::UTF8.GetString($all, 0, $headerEnd)
  $lines = $headerText -split "`r`n"
  $requestLine = $lines[0]
  $headers = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    $idx = $line.IndexOf(':')
    if ($idx -gt 0) {
      $key = $line.Substring(0, $idx).Trim().ToLower()
      $headers[$key] = $line.Substring($idx + 1).Trim()
    }
  }
  $bodyMs = New-Object System.IO.MemoryStream
  $start = $headerEnd + 4
  if ($all.Length -gt $start) { $bodyMs.Write($all, $start, $all.Length - $start) }
  $contentLength = 0
  if ($headers.ContainsKey('content-length')) {
    [void][int]::TryParse([string]$headers['content-length'], [ref]$contentLength)
  }
  while ($bodyMs.Length -lt $contentLength) {
    $need = [int]$contentLength - [int]$bodyMs.Length
    if ($need -gt $buffer.Length) { $need = $buffer.Length }
    $r = $stream.Read($buffer, 0, $need)
    if ($r -le 0) { break }
    $bodyMs.Write($buffer, 0, $r)
  }
  $bodyText = ''
  if ($bodyMs.Length -gt 0) {
    $bodyText = [System.Text.Encoding]::UTF8.GetString($bodyMs.ToArray())
  }
  return @{
    method = $requestLine.Split(' ')[0]
    target = $requestLine.Split(' ')[1]
    headers = $headers
    body = $bodyText
  }
}

function Send-Bytes($stream, $status, $contentType, $bytes) {
  $reason = 'OK'
  if ($status -eq 400) { $reason = 'Bad Request' }
  elseif ($status -eq 403) { $reason = 'Forbidden' }
  elseif ($status -eq 404) { $reason = 'Not Found' }
  elseif ($status -eq 409) { $reason = 'Conflict' }
  elseif ($status -eq 500) { $reason = 'Internal Server Error' }
  $header = 'HTTP/1.1 ' + $status + ' ' + $reason + "`r`n" +
    'Content-Type: ' + $contentType + "`r`n" +
    'Content-Length: ' + $bytes.Length + "`r`n" +
    'Cache-Control: no-store' + "`r`n" +
    'Access-Control-Allow-Origin: *' + "`r`n" +
    'Connection: close' + "`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($hb, 0, $hb.Length)
  if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

function Send-Json($stream, $status, $obj) {
  $text = ConvertTo-Json -InputObject $obj -Depth 40 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  Send-Bytes $stream $status 'application/json; charset=utf-8' $bytes
}

function Send-Error($stream, $status, $message) {
  Send-Json $stream $status @{ ok = $false; error = $message }
}

function Parse-Body($request) {
  if ([string]::IsNullOrWhiteSpace($request.body)) { return $null }
  try {
    return ConvertFrom-Json -InputObject $request.body
  } catch {
    return $null
  }
}

function Get-Auth($request, $body) {
  if (-not $body) { return @{ error = 'empty request' } }
  $code = [string]$body.room
  $token = [string]$body.token
  if (-not $Rooms.ContainsKey($code)) { return @{ error = 'room not found' } }
  $room = $Rooms[$code]
  if ($room.closed) { return @{ error = 'room closed' } }
  if (-not $room.tokens.ContainsKey($token)) { return @{ error = 'invalid token' } }
  $slot = [int]$room.tokens[$token]
  if (-not $room.players.ContainsKey($slot)) { return @{ error = 'seat released' } }
  $player = $room.players[$slot]
  $player.lastSeen = Get-NowMs
  $room.lastActivity = Get-NowMs
  return @{ room = $room; slot = $slot; player = $player }
}

function Handle-Api($stream, $request) {
  $target = [string]$request.target
  $qIdx = $target.IndexOf('?')
  $path = $target
  $query = @{}
  if ($qIdx -ge 0) {
    $path = $target.Substring(0, $qIdx)
    $qs = $target.Substring($qIdx + 1)
    foreach ($pair in $qs.Split('&')) {
      if ([string]::IsNullOrWhiteSpace($pair)) { continue }
      $eq = $pair.IndexOf('=')
      if ($eq -gt 0) {
        $key = [Uri]::UnescapeDataString($pair.Substring(0, $eq))
        $val = [Uri]::UnescapeDataString($pair.Substring($eq + 1))
        $query[$key] = $val
      }
    }
  }
  $action = $path -replace '^/api/', ''
  $method = [string]$request.method

  if ($action -eq 'health' -and $method -eq 'GET') {
    Send-Json $stream 200 @{ ok = $true; app = 'oiopoly-lan'; rooms = $Rooms.Count; port = $Port; time = (Get-NowMs) }
    return
  }

  if ($action -eq 'create' -and $method -eq 'POST') {
    $body = Parse-Body $request
    if (-not $body) { Send-Error $stream 400 'bad json'; return }
    $code = New-RoomCode
    $token = New-Token
    $name = Clean-Name $body.name
    $room = @{
      code = $code
      hostSlot = 0
      started = $false
      config = (Clean-Config $body.config)
      players = @{}
      tokens = @{}
      messages = (New-Object System.Collections.ArrayList)
      nextIndex = 1
      bytes = 0
      createdAt = (Get-NowMs)
      lastActivity = (Get-NowMs)
      closed = $false
    }
    $room.players[0] = @{ name = $name; lastSeen = (Get-NowMs) }
    $room.tokens[$token] = 0
    $Rooms[$code] = $room
    [void](Push-Room $room)
    [void](Push-System $room ($name + ' created room ' + $code))
    Write-Log ('create room ' + $code + ' host ' + $name)
    Send-Json $stream 200 @{ ok = $true; room = $code; token = $token; slot = 0; view = (Get-RoomView $room) }
    return
  }

  if ($action -eq 'join' -and $method -eq 'POST') {
    $body = Parse-Body $request
    if (-not $body) { Send-Error $stream 400 'bad json'; return }
    $code = [string]$body.room
    if (-not $Rooms.ContainsKey($code)) { Send-Error $stream 404 'room not found'; return }
    $room = $Rooms[$code]
    if ($room.closed) { Send-Error $stream 404 'room closed'; return }
    if ($room.started) { Send-Error $stream 409 'game already started'; return }
    if ($room.players.Count -ge $MaxPlayers) { Send-Error $stream 409 'room is full'; return }
    $slot = -1
    for ($i = 0; $i -lt $MaxPlayers; $i++) {
      if (-not $room.players.ContainsKey($i)) { $slot = $i; break }
    }
    if ($slot -lt 0) { Send-Error $stream 409 'room is full'; return }
    $token = New-Token
    $name = Clean-Name $body.name
    $room.players[$slot] = @{ name = $name; lastSeen = (Get-NowMs) }
    $room.tokens[$token] = $slot
    [void](Push-Room $room)
    [void](Push-System $room ($name + ' joined room'))
    Write-Log ('join room ' + $code + ' ' + $name + ' slot ' + $slot)
    Send-Json $stream 200 @{ ok = $true; room = $code; token = $token; slot = $slot; view = (Get-RoomView $room) }
    return
  }

  if ($action -eq 'state' -and $method -eq 'GET') {
    $code = [string]$query['room']
    $token = [string]$query['token']
    if (-not $Rooms.ContainsKey($code)) { Send-Error $stream 404 'room not found'; return }
    $room = $Rooms[$code]
    if ($room.closed) { Send-Error $stream 404 'room closed'; return }
    if (-not $room.tokens.ContainsKey($token)) { Send-Error $stream 403 'invalid token'; return }
    $slot = [int]$room.tokens[$token]
    if ($room.players.ContainsKey($slot)) { $room.players[$slot].lastSeen = Get-NowMs }
    $room.lastActivity = Get-NowMs
    $since = 0
    if ($query.ContainsKey('since')) { [void][int]::TryParse([string]$query['since'], [ref]$since) }
    $oldest = [int]$room.nextIndex
    if ($room.messages.Count -gt 0) { $oldest = [int]$room.messages[0].i }
    $reset = $false
    if ($since -lt ($oldest - 1)) { $reset = $true; $since = $oldest - 1 }
    $out = New-Object System.Collections.ArrayList
    foreach ($m in $room.messages) {
      if ([int]$m.i -gt $since) { [void]$out.Add($m) }
    }
    if ($out.Count -gt 320) {
      $trim = $out.Count - 320
      for ($i = 0; $i -lt $trim; $i++) { $out.RemoveAt(0) }
    }
    $cursor = 0
    if ($room.messages.Count -gt 0) { $cursor = [int]$room.messages[$room.messages.Count - 1].i }
    Send-Json $stream 200 @{ ok = $true; cursor = $cursor; oldest = $oldest; reset = $reset; messages = $out }
    return
  }

  if ($action -eq 'send' -and $method -eq 'POST') {
    $body = Parse-Body $request
    if (-not $body) { Send-Error $stream 400 'bad json'; return }
    $auth = Get-Auth $request $body
    if ($auth.error) { Send-Error $stream 403 $auth.error; return }
    $type = [string]$body.type
    if (@('action', 'snapshot', 'chat') -notcontains $type) { Send-Error $stream 400 'bad message type'; return }
    $toSlot = $null
    if ($null -ne $body.toSlot -and [string]$body.toSlot -ne '') { $toSlot = [int]$body.toSlot }
    $msg = Push-Message $auth.room @{
      type = $type
      from = $auth.slot
      fromName = [string]$auth.player.name
      toSlot = $toSlot
      payload = $body.payload
    }
    Send-Json $stream 200 @{ ok = $true; i = $msg.i }
    return
  }

  if ($action -eq 'config' -and $method -eq 'POST') {
    $body = Parse-Body $request
    if (-not $body) { Send-Error $stream 400 'bad json'; return }
    $auth = Get-Auth $request $body
    if ($auth.error) { Send-Error $stream 403 $auth.error; return }
    if ([int]$auth.slot -ne [int]$auth.room.hostSlot) { Send-Error $stream 403 'host only'; return }
    if ($auth.room.started) { Send-Error $stream 409 'game already started'; return }
    $cfg = $body.config
    if (-not $cfg) { $cfg = $body.payload }
    $auth.room.config = Clean-Config $cfg
    [void](Push-Room $auth.room)
    Send-Json $stream 200 @{ ok = $true; view = (Get-RoomView $auth.room) }
    return
  }

  if ($action -eq 'start' -and $method -eq 'POST') {
    $body = Parse-Body $request
    if (-not $body) { Send-Error $stream 400 'bad json'; return }
    $auth = Get-Auth $request $body
    if ($auth.error) { Send-Error $stream 403 $auth.error; return }
    if ([int]$auth.slot -ne [int]$auth.room.hostSlot) { Send-Error $stream 403 'host only'; return }
    if ($auth.room.started) { Send-Error $stream 409 'game already started'; return }
    $auth.room.started = $true
    if ($body.config) { $auth.room.config = Clean-Config $body.config }
    $roster = New-Object System.Collections.ArrayList
    foreach ($key in $auth.room.players.Keys) {
      [void]$roster.Add(@{ slot = [int]$key; name = [string]$auth.room.players[$key].name })
    }
    $rosterSorted = @($roster | Sort-Object { $_.slot })
    [void](Push-Message $auth.room @{
      type = 'start'
      from = $auth.room.hostSlot
      payload = @{ config = $auth.room.config; roster = $rosterSorted }
    })
    [void](Push-Room $auth.room)
    Write-Log ('start room ' + $auth.room.code)
    Send-Json $stream 200 @{ ok = $true; config = $auth.room.config; roster = $rosterSorted }
    return
  }

  if ($action -eq 'leave' -and $method -eq 'POST') {
    $body = Parse-Body $request
    if (-not $body) { Send-Json $stream 200 @{ ok = $true }; return }
    $code = [string]$body.room
    $token = [string]$body.token
    if (-not $Rooms.ContainsKey($code)) { Send-Json $stream 200 @{ ok = $true }; return }
    $room = $Rooms[$code]
    if (-not $room.tokens.ContainsKey($token)) { Send-Json $stream 200 @{ ok = $true }; return }
    $slot = [int]$room.tokens[$token]
    $name = 'player'
    if ($room.players.ContainsKey($slot)) { $name = [string]$room.players[$slot].name }
    $room.tokens.Remove($token)
    $room.players.Remove($slot)
    if ($slot -eq [int]$room.hostSlot) {
      $room.closed = $true
      [void](Push-Message $room @{ type = 'closed'; payload = @{ reason = 'host left' } })
      Write-Log ('host left, close room ' + $code)
    } else {
      [void](Push-Room $room)
      [void](Push-System $room ($name + ' left room'))
      Write-Log ('leave room ' + $code + ' slot ' + $slot)
    }
    Send-Json $stream 200 @{ ok = $true }
    return
  }

  Send-Error $stream 404 'api not found'
}

function Handle-Static($stream, $request) {
  $target = [string]$request.target
  $qIdx = $target.IndexOf('?')
  if ($qIdx -ge 0) { $target = $target.Substring(0, $qIdx) }
  $pathname = [Uri]::UnescapeDataString($target)
  if ($pathname -eq '/' -or $pathname -eq '') { $pathname = '/index.html' }
  if ($pathname.IndexOf([char]0) -ge 0) { Send-Error $stream 403 'forbidden'; return }
  $rel = $pathname.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
  $filePath = [IO.Path]::GetFullPath((Join-Path $Root $rel))
  $rootFull = [IO.Path]::GetFullPath($Root)
  if (-not ($filePath.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar))) {
    Send-Error $stream 403 'forbidden'
    return
  }
  if (-not [IO.File]::Exists($filePath)) {
    Send-Bytes $stream 404 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('404 Not Found'))
    return
  }
  $ext = [IO.Path]::GetExtension($filePath).ToLower()
  $type = 'application/octet-stream'
  if ($Mime.ContainsKey($ext)) { $type = $Mime[$ext] }
  $bytes = [IO.File]::ReadAllBytes($filePath)
  Send-Bytes $stream 200 $type $bytes
}

function Handle-Client($client) {
  $client.ReceiveTimeout = 15000
  $client.NoDelay = $true
  $stream = $client.GetStream()
  $request = Read-Request $stream
  if ($null -eq $request) { return }
  $target = [string]$request.target
  if ($target.StartsWith('/api/')) {
    Handle-Api $stream $request
  } else {
    if ($request.method -ne 'GET' -and $request.method -ne 'HEAD') {
      Send-Error $stream 405 'method not allowed'
      return
    }
    Handle-Static $stream $request
  }
}

function Get-LanAddresses {
  $list = @()
  try {
    $addresses = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())
    foreach ($a in $addresses) {
      if ($a.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
        if (-not [System.Net.IPAddress]::IsLoopback($a)) { $list += $a.ToString() }
      }
    }
  } catch { }
  return $list
}

# ---------------- main ----------------
$listener = New-Object System.Net.Sockets.TcpListener -ArgumentList @([System.Net.IPAddress]::Any, $Port)
$listener.Start()

Write-Host ''
Write-Host '  =============================================='
Write-Host '   OI-OPOLY - LAN Server (PowerShell)'
Write-Host '  =============================================='
Write-Host ('   Local:    http://127.0.0.1:' + $Port)
$lan = Get-LanAddresses
foreach ($a in $lan) {
  Write-Host ('   LAN:      http://' + $a + ':' + $Port)
}
if ($lan.Count -eq 0) { Write-Host '   No LAN IPv4 address found.' }
Write-Host ''
Write-Host '   Open the LAN address on other devices in the same Wi-Fi.'
Write-Host '   Allow PowerShell through Windows Firewall if asked.'
Write-Host '   Press Ctrl+C to stop.'
Write-Host ''

try {
  Start-Process ('http://127.0.0.1:' + $Port) | Out-Null
} catch { }

$lastClean = Get-NowMs
while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    Handle-Client $client
  } catch {
    Write-Log ('request error: ' + $_.Exception.Message)
  } finally {
    try { $client.Close() } catch { }
  }
  $now = Get-NowMs
  if (($now - $lastClean) -gt 30000) {
    $lastClean = $now
    $drop = @()
    foreach ($key in $Rooms.Keys) {
      $room = $Rooms[$key]
      if ($room.closed -and (($now - [int64]$room.lastActivity) -gt 60000)) { $drop += $key }
      elseif ((-not $room.closed) -and (($now - [int64]$room.lastActivity) -gt 14400000)) { $drop += $key }
    }
    foreach ($key in $drop) { $Rooms.Remove($key) }
  }
}
