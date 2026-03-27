param(
    [int]$Port = 8080,
    [string]$ListenHost = '127.0.0.1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SiteRoot = Join-Path $ScriptRoot 'wwwroot'
$DataRoot = Join-Path $ScriptRoot 'storage'
$TracksRoot = Join-Path $DataRoot 'tracks'
$LibraryPath = Join-Path $DataRoot 'library.json'
$EnvFilePath = Join-Path $ScriptRoot '.env.local'
$MaxSongs = 5
$MaxUploadBytes = 40MB
$HeaderLimitBytes = 65536
$AdminCookieName = 'bapuer-local-admin'

$MimeTypes = @{
    '.aac'  = 'audio/aac'
    '.css'  = 'text/css; charset=utf-8'
    '.flac' = 'audio/flac'
    '.html' = 'text/html; charset=utf-8'
    '.ico'  = 'image/x-icon'
    '.jpeg' = 'image/jpeg'
    '.jpg'  = 'image/jpeg'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.m4a'  = 'audio/mp4'
    '.mp3'  = 'audio/mpeg'
    '.ogg'  = 'audio/ogg'
    '.png'  = 'image/png'
    '.svg'  = 'image/svg+xml'
    '.txt'  = 'text/plain; charset=utf-8'
    '.wav'  = 'audio/wav'
    '.webp' = 'image/webp'
}

function Get-ListenAddress {
    param([Parameter(Mandatory = $true)][string]$InputHost)

    switch ($InputHost.ToLowerInvariant()) {
        '*' { return [System.Net.IPAddress]::Any }
        '0.0.0.0' { return [System.Net.IPAddress]::Any }
        'any' { return [System.Net.IPAddress]::Any }
        'localhost' { return [System.Net.IPAddress]::Loopback }
        '127.0.0.1' { return [System.Net.IPAddress]::Loopback }
        default {
            return [System.Net.IPAddress]::Parse($InputHost)
        }
    }
}

function Get-ConfigValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Default = ''
    )

    if (-not (Test-Path -LiteralPath $EnvFilePath -PathType Leaf)) {
        return $Default
    }

    $prefix = "$Name="
    foreach ($line in Get-Content -LiteralPath $EnvFilePath -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
            continue
        }

        if ($line.StartsWith($prefix)) {
            return $line.Substring($prefix.Length)
        }
    }

    return $Default
}

$AdminPassword = Get-ConfigValue -Name 'ADMIN_PASSWORD' -Default '110'

foreach ($path in @($SiteRoot, $DataRoot, $TracksRoot)) {
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path | Out-Null
    }
}

if (-not (Test-Path -LiteralPath $LibraryPath)) {
    Set-Content -LiteralPath $LibraryPath -Value '[]' -Encoding UTF8
}

function Get-Library {
    if (-not (Test-Path -LiteralPath $LibraryPath)) {
        return @()
    }

    $raw = Get-Content -LiteralPath $LibraryPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @()
    }

    $parsed = $raw | ConvertFrom-Json
    if ($null -eq $parsed) {
        return @()
    }

    return @($parsed)
}

function Save-Library {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][array]$Songs)

    $json = ConvertTo-Json -InputObject $Songs -Depth 8
    Set-Content -LiteralPath $LibraryPath -Value $json -Encoding UTF8
}

function Get-ContentType {
    param([Parameter(Mandatory = $true)][string]$Path)

    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($MimeTypes.ContainsKey($extension)) {
        return $MimeTypes[$extension]
    }

    return 'application/octet-stream'
}

function Get-SafeFileName {
    param([Parameter(Mandatory = $true)][string]$FileName)

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $extension = [System.IO.Path]::GetExtension($FileName).ToLowerInvariant()
    $safeBase = ($baseName -replace '[^a-zA-Z0-9\-_]+', '-').Trim('-')

    if ([string]::IsNullOrWhiteSpace($safeBase)) {
        $safeBase = 'track'
    }

    return "$safeBase$extension"
}

function Get-HueFromText {
    param([string]$Text)

    $hash = 37
    foreach ($character in $Text.ToCharArray()) {
        $hash = (($hash * 31) + [int][char]$character) % 360
    }

    return [Math]::Abs($hash)
}

function Get-PublicSong {
    param([Parameter(Mandatory = $true)]$Song)

    return [ordered]@{
        id         = $Song.id
        title      = $Song.title
        artist     = $Song.artist
        album      = $Song.album
        note       = $Song.note
        fileName   = $Song.fileName
        mimeType   = $Song.mimeType
        size       = $Song.size
        uploadedAt = $Song.uploadedAt
        accentHue  = $Song.accentHue
        streamUrl  = "/media/$($Song.storedFile)"
    }
}

function Get-StatusText {
    param([int]$StatusCode)

    switch ($StatusCode) {
        200 { return 'OK' }
        201 { return 'Created' }
        206 { return 'Partial Content' }
        400 { return 'Bad Request' }
        404 { return 'Not Found' }
        405 { return 'Method Not Allowed' }
        409 { return 'Conflict' }
        413 { return 'Payload Too Large' }
        416 { return 'Range Not Satisfiable' }
        500 { return 'Internal Server Error' }
        default { return 'OK' }
    }
}

function Read-ExactBytes {
    param(
        [Parameter(Mandatory = $true)]$Stream,
        [Parameter(Mandatory = $true)][int]$Length
    )

    if ($Length -le 0) {
        return [byte[]]::new(0)
    }

    $buffer = New-Object byte[] $Length
    $offset = 0
    while ($offset -lt $Length) {
        $read = $Stream.Read($buffer, $offset, $Length - $offset)
        if ($read -le 0) {
            throw 'Unexpected end of stream.'
        }
        $offset += $read
    }

    return $buffer
}

function Read-HeaderBytes {
    param([Parameter(Mandatory = $true)]$Stream)

    $bytes = New-Object 'System.Collections.Generic.List[byte]'
    while ($bytes.Count -lt $HeaderLimitBytes) {
        $next = $Stream.ReadByte()
        if ($next -lt 0) {
            if ($bytes.Count -eq 0) {
                return $null
            }
            break
        }

        $bytes.Add([byte]$next)
        $count = $bytes.Count
        if ($count -ge 4 -and
            $bytes[$count - 4] -eq 13 -and
            $bytes[$count - 3] -eq 10 -and
            $bytes[$count - 2] -eq 13 -and
            $bytes[$count - 1] -eq 10) {
            return $bytes.ToArray()
        }
    }

    throw 'Request headers exceed limit.'
}

function Read-HttpRequest {
    param([Parameter(Mandatory = $true)]$Client)

    $stream = $Client.GetStream()
    $headerBytes = Read-HeaderBytes -Stream $stream
    if ($null -eq $headerBytes) {
        return $null
    }

    $headerText = [System.Text.Encoding]::ASCII.GetString($headerBytes)
    $headerLines = $headerText.Substring(0, $headerText.Length - 4) -split "`r`n"
    if ($headerLines.Count -eq 0) {
        throw 'Malformed request.'
    }

    $requestLineParts = $headerLines[0].Split(' ')
    if ($requestLineParts.Count -lt 2) {
        throw 'Malformed request line.'
    }

    $headers = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($line in $headerLines[1..($headerLines.Count - 1)]) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        $separatorIndex = $line.IndexOf(':')
        if ($separatorIndex -lt 1) {
            continue
        }

        $name = $line.Substring(0, $separatorIndex).Trim()
        $value = $line.Substring($separatorIndex + 1).Trim()
        $headers[$name] = $value
    }

    $contentLength = 0
    if ($headers.ContainsKey('Content-Length')) {
        $contentLength = [int]$headers['Content-Length']
    }

    $bodyBytes = if ($contentLength -gt 0) { Read-ExactBytes -Stream $stream -Length $contentLength } else { [byte[]]::new(0) }
    $rawTarget = $requestLineParts[1]
    $pathPart = ($rawTarget -split '\?')[0]

    return [ordered]@{
        Method  = $requestLineParts[0].ToUpperInvariant()
        Path    = [System.Uri]::UnescapeDataString($pathPart)
        RawTarget = $rawTarget
        Headers = $headers
        Body    = $bodyBytes
    }
}

function Write-ResponseHeaders {
    param(
        [Parameter(Mandatory = $true)]$Stream,
        [Parameter(Mandatory = $true)][int]$StatusCode,
        [Parameter(Mandatory = $true)][string]$ContentType,
        [Parameter(Mandatory = $true)][long]$ContentLength,
        [hashtable]$Headers = @{}
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("HTTP/1.1 $StatusCode $(Get-StatusText -StatusCode $StatusCode)")
    $lines.Add("Content-Type: $ContentType")
    $lines.Add("Content-Length: $ContentLength")
    $lines.Add('Connection: close')
    foreach ($key in $Headers.Keys) {
        $lines.Add(("{0}: {1}" -f $key, $Headers[$key]))
    }
    $lines.Add('')
    $lines.Add('')

    $headerBlock = [string]::Join("`r`n", $lines)
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerBlock)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
}

function Send-BytesResponse {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][int]$StatusCode,
        [Parameter(Mandatory = $true)][byte[]]$Body,
        [Parameter(Mandatory = $true)][string]$ContentType,
        [hashtable]$Headers = @{}
    )

    $stream = $Client.GetStream()
    try {
        Write-ResponseHeaders -Stream $stream -StatusCode $StatusCode -ContentType $ContentType -ContentLength $Body.Length -Headers $Headers
        if ($Body.Length -gt 0) {
            $stream.Write($Body, 0, $Body.Length)
        }
        $stream.Flush()
    }
    finally {
        $Client.Close()
    }
}

function Send-TextResponse {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][int]$StatusCode,
        [Parameter(Mandatory = $true)][string]$Text,
        [string]$ContentType = 'text/plain; charset=utf-8',
        [hashtable]$Headers = @{}
    )

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    Send-BytesResponse -Client $Client -StatusCode $StatusCode -Body $bytes -ContentType $ContentType -Headers $Headers
}

function Send-JsonResponse {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][int]$StatusCode,
        [Parameter(Mandatory = $true)]$Payload,
        [hashtable]$Headers = @{}
    )

    $json = ConvertTo-Json -InputObject $Payload -Depth 8
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    Send-BytesResponse -Client $Client -StatusCode $StatusCode -Body $bytes -ContentType 'application/json; charset=utf-8' -Headers $Headers
}

function Get-Cookies {
    param([Parameter(Mandatory = $true)]$Request)

    $cookies = @{}
    if (-not $Request.Headers.ContainsKey('Cookie')) {
        return $cookies
    }

    $parts = $Request.Headers['Cookie'] -split ';'
    foreach ($part in $parts) {
        $pair = $part.Trim()
        if ([string]::IsNullOrWhiteSpace($pair) -or -not $pair.Contains('=')) {
            continue
        }

        $separatorIndex = $pair.IndexOf('=')
        $name = $pair.Substring(0, $separatorIndex).Trim()
        $value = $pair.Substring($separatorIndex + 1).Trim()
        $cookies[$name] = $value
    }

    return $cookies
}

function Test-IsAuthenticated {
    param([Parameter(Mandatory = $true)]$Request)

    $cookies = Get-Cookies -Request $Request
    return $cookies.ContainsKey($AdminCookieName) -and $cookies[$AdminCookieName] -eq '1'
}

function Send-Unauthorized {
    param([Parameter(Mandatory = $true)]$Client)

    Send-JsonResponse -Client $Client -StatusCode 401 -Payload @{ error = 'Unauthorized.' }
}

function Handle-AdminSession {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)]$Request
    )

    Send-JsonResponse -Client $Client -StatusCode 200 -Payload @{ authenticated = (Test-IsAuthenticated -Request $Request) }
}

function Handle-AdminLogin {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)]$Request
    )

    $body = Get-JsonFromBody -Body $Request.Body
    $password = [string]$body.password
    if ($password -ne $AdminPassword) {
        Send-JsonResponse -Client $Client -StatusCode 401 -Payload @{ error = 'Password is incorrect.' }
        return
    }

    Send-JsonResponse -Client $Client -StatusCode 200 -Payload @{ ok = $true } -Headers @{
        'Set-Cookie' = "$AdminCookieName=1; Path=/; Max-Age=604800; SameSite=Lax"
    }
}

function Handle-AdminLogout {
    param([Parameter(Mandatory = $true)]$Client)

    Send-JsonResponse -Client $Client -StatusCode 200 -Payload @{ ok = $true } -Headers @{
        'Set-Cookie' = "$AdminCookieName=; Path=/; Max-Age=0; SameSite=Lax"
    }
}

function Send-FileResponse {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)]$Request,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string]$ContentType,
        [switch]$EnableRanges
    )

    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        Send-TextResponse -Client $Client -StatusCode 404 -Text 'Not found.'
        return
    }

    $fileInfo = Get-Item -LiteralPath $FilePath
    $fileLength = [int64]$fileInfo.Length
    $start = 0L
    $end = $fileLength - 1
    $statusCode = 200
    $headers = @{ 'Accept-Ranges' = 'bytes' }

    if ($EnableRanges -and $Request.Headers.ContainsKey('Range')) {
        $rangeValue = $Request.Headers['Range']
        if ($rangeValue -notmatch '^bytes=(\d*)-(\d*)$') {
            Send-TextResponse -Client $Client -StatusCode 416 -Text 'Invalid range.'
            return
        }

        $startText = $Matches[1]
        $endText = $Matches[2]

        if ([string]::IsNullOrWhiteSpace($startText) -and [string]::IsNullOrWhiteSpace($endText)) {
            Send-TextResponse -Client $Client -StatusCode 416 -Text 'Invalid range.'
            return
        }

        if ([string]::IsNullOrWhiteSpace($startText)) {
            $suffixLength = [int64]$endText
            if ($suffixLength -le 0) {
                Send-TextResponse -Client $Client -StatusCode 416 -Text 'Invalid range.'
                return
            }
            $start = [Math]::Max(0, $fileLength - $suffixLength)
            $end = $fileLength - 1
        }
        else {
            $start = [int64]$startText
            if ([string]::IsNullOrWhiteSpace($endText)) {
                $end = $fileLength - 1
            }
            else {
                $end = [int64]$endText
            }
        }

        if ($start -lt 0 -or $end -lt $start -or $start -ge $fileLength) {
            Send-BytesResponse -Client $Client -StatusCode 416 -Body ([byte[]]::new(0)) -ContentType 'text/plain; charset=utf-8' -Headers @{ 'Content-Range' = "bytes */$fileLength" }
            return
        }

        if ($end -ge $fileLength) {
            $end = $fileLength - 1
        }

        $statusCode = 206
        $headers['Content-Range'] = "bytes $start-$end/$fileLength"
    }

    $length = ($end - $start) + 1
    $networkStream = $Client.GetStream()
    $fileStream = [System.IO.File]::OpenRead($FilePath)
    try {
        Write-ResponseHeaders -Stream $networkStream -StatusCode $statusCode -ContentType $ContentType -ContentLength $length -Headers $headers
        [void]$fileStream.Seek($start, [System.IO.SeekOrigin]::Begin)
        $buffer = New-Object byte[] 65536
        $remaining = $length
        while ($remaining -gt 0) {
            $chunkSize = [Math]::Min([int64]$buffer.Length, $remaining)
            $read = $fileStream.Read($buffer, 0, [int]$chunkSize)
            if ($read -le 0) {
                break
            }

            $networkStream.Write($buffer, 0, $read)
            $remaining -= $read
        }
        $networkStream.Flush()
    }
    finally {
        $fileStream.Dispose()
        $Client.Close()
    }
}

function Get-StaticFilePath {
    param([Parameter(Mandatory = $true)][string]$RequestPath)

    $relativePath = $RequestPath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = 'index.html'
    }

    $relativePath = $relativePath -replace '/', '\'
    $candidatePath = [System.IO.Path]::GetFullPath((Join-Path $SiteRoot $relativePath))
    $siteRootFull = [System.IO.Path]::GetFullPath($SiteRoot)

    if (-not $candidatePath.StartsWith($siteRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }

    return $candidatePath
}

function Get-JsonFromBody {
    param([Parameter(Mandatory = $true)][byte[]]$Body)

    if ($Body.Length -eq 0) {
        throw 'Request body is empty.'
    }

    $text = [System.Text.Encoding]::UTF8.GetString($Body)
    return $text | ConvertFrom-Json
}

function Handle-Upload {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)]$Request
    )

    if (-not (Test-IsAuthenticated -Request $Request)) {
        Send-Unauthorized -Client $Client
        return
    }

    if ($Request.Body.Length -gt $MaxUploadBytes) {
        Send-JsonResponse -Client $Client -StatusCode 413 -Payload @{ error = 'Each song must be 40MB or smaller.' }
        return
    }

    $body = Get-JsonFromBody -Body $Request.Body
    $library = @(Get-Library)

    if ($library.Count -ge $MaxSongs) {
        Send-JsonResponse -Client $Client -StatusCode 409 -Payload @{ error = "Only $MaxSongs songs can be stored. Delete one before uploading another." }
        return
    }

    $title = [string]$body.title
    $artist = [string]$body.artist
    $album = [string]$body.album
    $note = [string]$body.note
    $fileName = [string]$body.fileName
    $mimeType = [string]$body.mimeType
    $contentBase64 = [string]$body.contentBase64

    if ([string]::IsNullOrWhiteSpace($title) -or [string]::IsNullOrWhiteSpace($fileName) -or [string]::IsNullOrWhiteSpace($contentBase64)) {
        Send-JsonResponse -Client $Client -StatusCode 400 -Payload @{ error = 'Title, file name, and song file are required.' }
        return
    }

    $extension = [System.IO.Path]::GetExtension($fileName).ToLowerInvariant()
    $allowedExtensions = @('.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac')
    if ($allowedExtensions -notcontains $extension) {
        Send-JsonResponse -Client $Client -StatusCode 400 -Payload @{ error = 'Only MP3, WAV, OGG, M4A, AAC, and FLAC files are supported.' }
        return
    }

    try {
        $bytes = [System.Convert]::FromBase64String($contentBase64)
    }
    catch {
        Send-JsonResponse -Client $Client -StatusCode 400 -Payload @{ error = 'Upload content could not be parsed. Please choose the file again.' }
        return
    }

    if ($bytes.Length -gt $MaxUploadBytes) {
        Send-JsonResponse -Client $Client -StatusCode 413 -Payload @{ error = 'Each song must be 40MB or smaller.' }
        return
    }

    $id = [System.Guid]::NewGuid().ToString('N').Substring(0, 12)
    $safeFileName = Get-SafeFileName -FileName $fileName
    $storedFile = "$id-$safeFileName"
    $destinationPath = Join-Path $TracksRoot $storedFile
    [System.IO.File]::WriteAllBytes($destinationPath, $bytes)

    if ([string]::IsNullOrWhiteSpace($mimeType)) {
        $mimeType = Get-ContentType -Path $destinationPath
    }

    $song = [ordered]@{
        id         = $id
        title      = $title.Trim()
        artist     = $artist.Trim()
        album      = $album.Trim()
        note       = $note.Trim()
        fileName   = $fileName
        storedFile = $storedFile
        mimeType   = $mimeType
        size       = $bytes.Length
        uploadedAt = [DateTime]::UtcNow.ToString('o')
        accentHue  = Get-HueFromText -Text "$title|$artist|$album"
    }

    $updatedLibrary = @($library + $song)
    Save-Library -Songs $updatedLibrary
    Send-JsonResponse -Client $Client -StatusCode 201 -Payload (Get-PublicSong -Song $song)
}

function Handle-DeleteSong {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)]$Request,
        [Parameter(Mandatory = $true)][string]$SongId
    )

    if (-not (Test-IsAuthenticated -Request $Request)) {
        Send-Unauthorized -Client $Client
        return
    }

    $library = @(Get-Library)
    $song = $library | Where-Object { $_.id -eq $SongId } | Select-Object -First 1
    if ($null -eq $song) {
        Send-JsonResponse -Client $Client -StatusCode 404 -Payload @{ error = 'Song not found.' }
        return
    }

    $updatedLibrary = @($library | Where-Object { $_.id -ne $SongId })
    $filePath = Join-Path $TracksRoot $song.storedFile
    if (Test-Path -LiteralPath $filePath) {
        Remove-Item -LiteralPath $filePath -Force
    }

    Save-Library -Songs $updatedLibrary
    Send-JsonResponse -Client $Client -StatusCode 200 -Payload @{ ok = $true }
}

function Handle-Request {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)]$Request
    )

    $method = $Request.Method
    $path = $Request.Path

    if ($method -eq 'GET' -and $path -eq '/api/songs') {
        $songs = @(Get-Library | Sort-Object uploadedAt | ForEach-Object { Get-PublicSong -Song $_ })
        Send-JsonResponse -Client $Client -StatusCode 200 -Payload $songs
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/admin/session') {
        Handle-AdminSession -Client $Client -Request $Request
        return
    }

    if ($method -eq 'POST' -and $path -eq '/api/admin/login') {
        Handle-AdminLogin -Client $Client -Request $Request
        return
    }

    if ($method -eq 'POST' -and $path -eq '/api/admin/logout') {
        Handle-AdminLogout -Client $Client
        return
    }

    if ($method -eq 'POST' -and $path -eq '/api/admin/upload') {
        Handle-Upload -Client $Client -Request $Request
        return
    }

    if ($method -eq 'DELETE' -and $path -match '^/api/admin/song/([a-zA-Z0-9]+)$') {
        Handle-DeleteSong -Client $Client -Request $Request -SongId $Matches[1]
        return
    }

    if ($method -eq 'GET' -and $path -match '^/media/([^/]+)$') {
        $storedFile = $Matches[1]
        $filePath = Join-Path $TracksRoot $storedFile
        Send-FileResponse -Client $Client -Request $Request -FilePath $filePath -ContentType (Get-ContentType -Path $filePath) -EnableRanges
        return
    }

    if ($method -eq 'GET' -and ($path -eq '/admin' -or $path -eq '/admin/')) {
        $adminPath = Join-Path $SiteRoot 'admin.html'
        Send-FileResponse -Client $Client -Request $Request -FilePath $adminPath -ContentType (Get-ContentType -Path $adminPath)
        return
    }

    if ($method -eq 'GET') {
        $staticFilePath = Get-StaticFilePath -RequestPath $path
        if ($null -eq $staticFilePath -or -not (Test-Path -LiteralPath $staticFilePath -PathType Leaf)) {
            Send-TextResponse -Client $Client -StatusCode 404 -Text 'Not found.'
            return
        }

        Send-FileResponse -Client $Client -Request $Request -FilePath $staticFilePath -ContentType (Get-ContentType -Path $staticFilePath)
        return
    }

    Send-TextResponse -Client $Client -StatusCode 405 -Text 'Method not allowed.'
}

$listenAddress = Get-ListenAddress -InputHost $ListenHost
$listener = [System.Net.Sockets.TcpListener]::new($listenAddress, $Port)
$listener.Start()

if ($listenAddress.Equals([System.Net.IPAddress]::Any)) {
    Write-Host "Bapuer Music Player running on all interfaces at port $Port"
    Write-Host "Try http://127.0.0.1:$Port or your LAN IP on the same Wi-Fi"
}
else {
    Write-Host "Bapuer Music Player running at http://$ListenHost`:$Port"
    Write-Host "Admin page: http://$ListenHost`:$Port/admin"
}
Write-Host "Press Ctrl+C to stop."

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $client.ReceiveTimeout = 10000
        $client.SendTimeout = 10000

        try {
            $request = Read-HttpRequest -Client $client
            if ($null -eq $request) {
                $client.Close()
                continue
            }

            Handle-Request -Client $client -Request $request
        }
        catch {
            try {
                Send-JsonResponse -Client $client -StatusCode 500 -Payload @{ error = 'Internal server error.'; detail = $_.Exception.Message }
            }
            catch {
                $client.Close()
            }
        }
    }
}
finally {
    $listener.Stop()
}
