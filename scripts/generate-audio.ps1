Add-Type -AssemblyName System.Speech

$slides = @(
    @{
        Id = 1
        Text = "Welcome to VT2: Verifiable Trading Technology, built for the Bitget AI Hackathon S2 Alpha Factory track. VT2 is a deterministic, risk-budgeted trading system for tokenized US equity perpetuals in paper-only mode."
    },
    @{
        Id = 2
        Text = "The VT2 terminal connects directly to Bitget public WebSocket feeds, showing live ticker data with 519 millisecond latency. The header displays simulated equity of 9,999 dollars, daily loss tracking under our 200 dollar budget, single-position cap, and an immediate Kill Switch."
    },
    @{
        Id = 3
        Text = "The Market Scanner evaluates 24 tokenized equity perpetuals using deterministic technical filters. Four contracts currently qualify with net reward-to-risk above 1.5, while disqualified symbols like SanDisk and Rocket Lab are rejected with explicit reasons like RSI overbought."
    },
    @{
        Id = 4
        Text = "The automated trader runs an autonomous 30-second evaluation loop. Here the bot is running, tracking 1 of 3 allowed daily trades. The activity feed documents a simulated market long fill on Tesla, verified stop loss, and continuous safety checks."
    },
    @{
        Id = 5
        Text = "The Positions tab tracks the active paper position on Tesla with real-time mark pricing, unrealised P and L, and bracket orders. Protective simulation controls allow testing sudden market spikes or drops, alongside live sentiment monitoring."
    },
    @{
        Id = 6
        Text = "The Risk Engine enforces hard mathematical limits: half a percent risk per trade, a 2 percent daily loss cap, single position concurrency, and a 30-minute cooldown after 3 consecutive losses. Parameters are deterministic and cannot be bypassed."
    },
    @{
        Id = 7
        Text = "Here is our honest Alpha Factory backtest across 287 trades. The strategy recorded a negative 28.25 percent return and Sharpe of minus 4.46, underperforming the S and P 500 benchmark. Traded friction was the dominant driver: over 3,400 dollars in fees and slippage from 258 times turnover erased gross edge. This rigorous, unfabricated reporting proves why real execution costs matter."
    },
    @{
        Id = 8
        Text = "VT2 proves verifiable, execution-aware systems with zero fabricated claims. Explore the full open-source codebase on GitHub and test the hosted read-only demo. Remember: No language model makes trading decisions. Rules do. AI coding assistants helped build it."
    }
)

$results = @()
$totalSec = 0

foreach ($s in $slides) {
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.Rate = 1 # Slightly brisker, natural and clear
    $pb = New-Object System.Speech.Synthesis.PromptBuilder
    $pb.AppendText($s.Text)
    $pb.AppendBreak([TimeSpan]::FromMilliseconds(600))
    
    $wavPath = "media\audio\slide$($s.Id).wav"
    $synth.SetOutputToWaveFile($wavPath)
    $synth.Speak($pb)
    $synth.Dispose()
    
    $fileStream = [System.IO.File]::OpenRead($wavPath)
    $reader = New-Object System.IO.BinaryReader($fileStream)
    $fileStream.Position = 28
    $byteRate = $reader.ReadInt32()
    $fileLen = $fileStream.Length
    $reader.Close()
    $fileStream.Close()
    
    $duration = [Math]::Round(($fileLen - 44) / $byteRate, 2)
    $totalSec += $duration
    
    $results += [PSCustomObject]@{
        Slide = $s.Id
        DurationSec = $duration
        WavFile = $wavPath
    }
}

$results | Format-Table -AutoSize
Write-Host "Total Audio Duration: $totalSec seconds ($([Math]::Floor($totalSec / 60))m $([Math]::Round($totalSec % 60))s)"
