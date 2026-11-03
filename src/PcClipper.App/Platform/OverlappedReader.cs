using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace PcClipper.App.Platform;

/// <summary>Receives one report; the span is only valid during the call.</summary>
internal delegate void ReportHandler(ReadOnlySpan<byte> report);

/// <summary>
/// Keeps exactly one overlapped ReadFile pending on a handle opened with FILE_FLAG_OVERLAPPED (a HID device for
/// <see cref="SonyHidPads"/>) and hands out finished reads when polled, without ever blocking. Owns the handle.
/// Single-threaded: use from one thread only.
/// </summary>
/// <remarks>
/// <para>The OVERLAPPED and the buffer live in unmanaged memory, because Windows writes to them after ReadFile has
/// returned. <see cref="Pump"/> collects finished reads with GetOverlappedResult(bWait: false) and issues the next one
/// right away; when reports are queued (HID keeps a ring of input reports per handle) ReadFile completes at once, so
/// one call drains everything that arrived since the last poll.</para>
/// <para><see cref="Dispose"/> cancels the pending read (CancelIoEx), waits up to 1 s for Windows to finish with the
/// buffer, then frees it. If a stuck driver doesn't complete the cancel in that time, the memory is leaked rather than
/// freed under a write that may still come.</para>
/// </remarks>
internal sealed unsafe class OverlappedReader : IDisposable
{
    private const int ERROR_OPERATION_ABORTED = 995, ERROR_IO_INCOMPLETE = 996, ERROR_IO_PENDING = 997;
    private const uint WAIT_OBJECT_0 = 0;

    private readonly SafeFileHandle _handle;
    private readonly byte* _buffer;
    private readonly NativeOverlapped* _overlapped;
    private readonly IntPtr _event;
    private bool _pending;
    private bool _disposed;

    /// <summary>Reads of <paramref name="reportLength"/> bytes: exactly one HID input report (InputReportByteLength); a
    /// bigger buffer would let Windows put several queued reports into one read.</summary>
    public OverlappedReader(SafeFileHandle handle, int reportLength)
    {
        if (reportLength <= 0) throw new ArgumentOutOfRangeException(nameof(reportLength));
        _event = CreateEventW(IntPtr.Zero, true, false, IntPtr.Zero); // manual reset, as overlapped I/O wants
        if (_event == IntPtr.Zero) throw new InvalidOperationException($"CreateEvent failed (Windows error {Marshal.GetLastWin32Error()})");
        _handle = handle;
        BufferLength = reportLength;
        _buffer = (byte*)NativeMemory.AllocZeroed((nuint)reportLength);
        _overlapped = (NativeOverlapped*)NativeMemory.AllocZeroed((nuint)sizeof(NativeOverlapped));
    }

    public int BufferLength { get; }

    /// <summary>
    /// Hands every read finished since the last call to <paramref name="onReport"/> (at most <paramref name="maxReports"/>)
    /// and leaves a new read pending. Returns 0 while reading works, otherwise the Windows error that ended it
    /// (1167 ERROR_DEVICE_NOT_CONNECTED when unplugged, 31, 6, ...); the reader is then finished.
    /// </summary>
    public int Pump(int maxReports, ReportHandler onReport)
    {
        if (_disposed) return ERROR_OPERATION_ABORTED;
        for (int i = 0; i < maxReports; i++)
        {
            if (!_pending)
            {
                // ReadFile resets the event itself; the OVERLAPPED must be clean (offsets are ignored by devices).
                _overlapped->InternalLow = IntPtr.Zero;
                _overlapped->InternalHigh = IntPtr.Zero;
                _overlapped->OffsetLow = 0;
                _overlapped->OffsetHigh = 0;
                _overlapped->EventHandle = _event;
                if (!ReadFile(_handle, _buffer, (uint)BufferLength, null, _overlapped))
                {
                    int err = Marshal.GetLastWin32Error();
                    if (err != ERROR_IO_PENDING) return err == 0 ? ERROR_OPERATION_ABORTED : err;
                }
                _pending = true; // also when it finished at once: the result is collected the same way
            }

            if (!GetOverlappedResult(_handle, _overlapped, out uint read, false))
            {
                int err = Marshal.GetLastWin32Error();
                if (err == ERROR_IO_INCOMPLETE) return 0; // nothing new yet; the read stays pending
                _pending = false;
                if (err == ERROR_OPERATION_ABORTED) return 0; // cancelled by someone else's CancelIo; read again next time
                return err == 0 ? ERROR_OPERATION_ABORTED : err;
            }
            _pending = false;
            if (read == 0) continue;
            onReport(new ReadOnlySpan<byte>(_buffer, (int)Math.Min(read, (uint)BufferLength)));
        }
        return 0;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        bool safeToFree = true;
        if (_pending)
        {
            try
            {
                CancelIoEx(_handle, _overlapped);
                safeToFree = WaitForSingleObject(_event, 1000) == WAIT_OBJECT_0;
                if (safeToFree) GetOverlappedResult(_handle, _overlapped, out _, false);
            }
            catch { safeToFree = false; }
            _pending = false;
        }
        try { _handle.Dispose(); } catch { }
        if (!safeToFree) return; // leaked on purpose (see remarks)
        NativeMemory.Free(_buffer);
        NativeMemory.Free(_overlapped);
        CloseHandle(_event);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadFile(SafeFileHandle hFile, byte* lpBuffer, uint nNumberOfBytesToRead, uint* lpNumberOfBytesRead, NativeOverlapped* lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetOverlappedResult(SafeFileHandle hFile, NativeOverlapped* lpOverlapped, out uint lpNumberOfBytesTransferred, [MarshalAs(UnmanagedType.Bool)] bool bWait);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CancelIoEx(SafeFileHandle hFile, NativeOverlapped* lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateEventW(IntPtr lpEventAttributes, [MarshalAs(UnmanagedType.Bool)] bool bManualReset, [MarshalAs(UnmanagedType.Bool)] bool bInitialState, IntPtr lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);
}
