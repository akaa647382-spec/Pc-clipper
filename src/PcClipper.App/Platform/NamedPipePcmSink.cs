using System.IO.Pipes;
using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>\\.\pipe\pcclipper-audio-&lt;pid&gt;-&lt;guid&gt; server for ffmpeg to read PCM from (queueing is in the base class).</summary>
/// <remarks>
/// <para>ffmpeg opens <c>\\.\pipe\name</c> as a plain input file (file protocol: _wsopen read-only), so the server must
/// exist BEFORE ffmpeg starts, otherwise ffmpeg reports "No such file or directory". That's why the pipe is created in the
/// constructor; the engine creates the sink, then starts ffmpeg, then awaits the connection.</para>
/// <para>One instance (a second client would get ERROR_PIPE_BUSY), byte mode, outbound only, CurrentUserOnly (no other
/// account can connect or squat on the name), a 1 MiB advisory out-buffer (~2.7 s of 48 kHz float stereo). The name holds
/// our process id plus a GUID, so two sessions or two app instances never share a pipe.</para>
/// <para>If ffmpeg connects before <see cref="ConnectAsync"/> runs, .NET treats ERROR_PIPE_CONNECTED as success.
/// When ffmpeg exits, writes fail with IOException ("Pipe is broken" / "The pipe is being closed"); the base class turns
/// that into a sink failure. Disposing closes the pipe, which ffmpeg sees as end of file.</para>
/// </remarks>
public sealed class NamedPipePcmSink : QueuedPcmSink
{
    private const int OutBufferBytes = 1 << 20;

    private readonly NamedPipeServerStream _server;
    private readonly string _name;

    public NamedPipePcmSink()
    {
        _name = $"pcclipper-audio-{Environment.ProcessId}-{Guid.NewGuid():N}";
        _server = new NamedPipeServerStream(_name, PipeDirection.Out, 1, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly, inBufferSize: 0, outBufferSize: OutBufferBytes);
    }

    public override string FfmpegInputPath => @"\\.\pipe\" + _name;

    protected override async Task<Stream> ConnectAsync(CancellationToken ct)
    {
        await _server.WaitForConnectionAsync(ct).ConfigureAwait(false);
        return _server;
    }

    protected override void OnDisposed()
    {
        // Also aborts a WaitForConnectionAsync that is still pending (ffmpeg never opened the pipe).
        try { _server.Dispose(); } catch { /* already closed */ }
    }
}
