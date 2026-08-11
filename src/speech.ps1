# VoiceDeck Speech Recognition via Windows Speech API
# Usage: powershell -File speech.ps1 [lang] [timeout_ms]
# Returns: transcription on stdout, empty string if nothing heard

param(
    [string]$Lang = "pt-BR",
    [int]$TimeoutMs = 6000
)

try {
    Add-Type -AssemblyName System.Speech

    # Try to use the requested language, fallback to system default
    $recognizer = $null
    try {
        $culture = [System.Globalization.CultureInfo]::GetCultureInfo($Lang)
        $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
    } catch {
        # Fallback to system default language
        $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    }

    $recognizer.SetInputToDefaultAudioDevice()

    # Load dictation grammar (free-form speech)
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $recognizer.LoadGrammar($grammar)

    # Set timeouts
    $recognizer.InitialSilenceTimeout = [System.TimeSpan]::FromMilliseconds($TimeoutMs)
    $recognizer.BabbleTimeout = [System.TimeSpan]::FromMilliseconds($TimeoutMs)
    $recognizer.EndSilenceTimeout = [System.TimeSpan]::FromMilliseconds(800)

    # Synchronous recognize with timeout
    $result = $recognizer.Recognize([System.TimeSpan]::FromMilliseconds($TimeoutMs))

    if ($result -and $result.Text) {
        Write-Output $result.Text
    } else {
        Write-Output ""
    }

    $recognizer.Dispose()
} catch {
    # Output error to stderr, empty to stdout
    Write-Error "Speech recognition error: $_"
    Write-Output ""
}
