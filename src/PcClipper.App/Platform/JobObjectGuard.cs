using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// Kill-on-close job object (child ffmpeg dies with us), no power throttling, AboveNormal priority.
/// </summary>
/// <remarks>
/// <para>One job for the whole process. Its handle lives in a static field and is never closed: when PC Clipper exits or
/// crashes, Windows closes the last handle and JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE kills every ffmpeg in it, so an
/// orphaned ffmpeg can never keep recording. DIE_ON_UNHANDLED_EXCEPTION stops a crashing ffmpeg from showing a Windows
/// Error Reporting dialog over the game. Nested jobs are fine on Windows 8+, so this also works when a launcher (Steam)
/// already put us in a job.</para>
/// <para>PC Clipper itself is never put in the job: everything it starts would inherit it, and a video player opened with
/// "Open clip" would then be killed when PC Clipper exits.</para>
/// <para>Priority: AboveNormal keeps the capture loop on time without starving the game. A CPU encoder (libx264, libx265,
/// libsvtav1) stays Normal, because at a raised priority its encoder threads compete with the game for CPU. Saves are
/// lowered to BelowNormal by Core right after <see cref="Attach"/>, plus low disk and memory priority
/// (<see cref="LowerToBackground"/>). The capture also gets high GPU priority (<see cref="RaiseCaptureGpuPriority"/>).</para>
/// </remarks>
public sealed class JobObjectGuard : IProcessGuard
{
    private static readonly object s_gate = new();
    private static JobObjectGuard? s_instance;
    // Static => lives for the whole process; disposing or finalizing it early would kill the running ffmpeg.
    private static SafeFileHandle? s_job;

    private int _assignWarned;

    private JobObjectGuard()
    {
        try
        {
            var job = CreateJobObjectW(IntPtr.Zero, null);
            if (job.IsInvalid)
            {
                LastError = $"CreateJobObject failed (Windows error {Marshal.GetLastWin32Error()})";
                return;
            }
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()))
            {
                LastError = $"SetInformationJobObject failed (Windows error {Marshal.GetLastWin32Error()})";
                job.Dispose();
                return;
            }
            s_job = job;
        }
        catch (Exception ex)
        {
            LastError = "Job objects are unavailable: " + ex.Message;
        }
        if (LastError is not null)
            PlatformLog.Warn($"ffmpeg protection unavailable ({LastError}): if PC Clipper crashes, ffmpeg may keep running until it notices.");
    }

    /// <summary>The process-wide guard (created on first use; never throws).</summary>
    public static JobObjectGuard Instance
    {
        get
        {
            lock (s_gate) return s_instance ??= new JobObjectGuard();
        }
    }

    /// <summary>True when the kill-on-close job exists.</summary>
    public bool IsActive => s_job is { IsInvalid: false, IsClosed: false };

    /// <summary>Why the job could not be created, or null.</summary>
    public string? LastError { get; private set; }

    /// <summary>
    /// Call right after Process.Start (ffmpeg starts no children, so the tiny window before assignment is harmless).
    /// Never throws: each step that fails is logged and skipped.
    /// </summary>
    public void Attach(Process process)
    {
        IntPtr handle;
        try
        {
            if (process.HasExited) return;
            handle = process.Handle;
        }
        catch (Exception)
        {
            return; // already gone, or not a process we started
        }

        if (s_job is { IsInvalid: false } job)
        {
            try
            {
                if (!AssignProcessToJobObject(job, handle))
                {
                    int err = Marshal.GetLastWin32Error();
                    if (Interlocked.Exchange(ref _assignWarned, 1) == 0)
                        PlatformLog.Warn($"Could not put ffmpeg in the kill-on-close job (Windows error {err}).");
                }
            }
            catch (Exception ex)
            {
                if (Interlocked.Exchange(ref _assignWarned, 1) == 0)
                    PlatformLog.Warn("Could not put ffmpeg in the kill-on-close job: " + ex.Message);
            }
        }

        try
        {
            process.PriorityClass = UsesCpuEncoder(process) ? ProcessPriorityClass.Normal : ProcessPriorityClass.AboveNormal;
        }
        catch (Exception)
        {
            // Exited already, or not permitted: the default priority still works.
        }

        ProcessTuning.DisablePowerThrottling(handle, "ffmpeg");
    }

    private int _backgroundWarned;

    /// <summary>
    /// D3DKMT GPU scheduling priority HIGH for the capture ffmpeg (what OBS uses with hardware-accelerated GPU scheduling;
    /// REALTIME needs admin and has caused NVIDIA driver freezes, so it is never requested). Reads it back first and only
    /// sets it when needed. The <paramref name="verify"/> call (once capture runs) logs what Windows reports afterwards;
    /// the early call stays quiet, since ffmpeg may not have opened its GPU yet. Never throws.
    /// </summary>
    public void RaiseCaptureGpuPriority(Process process, bool verify)
    {
        try
        {
            if (process.HasExited) return;
            var h = process.SafeHandle;
            int status = 0;
            if (D3DKMTGetProcessSchedulingPriorityClass(h, out int current) < 0 || current < D3DKMT_SCHEDULINGPRIORITYCLASS_HIGH)
                status = D3DKMTSetProcessSchedulingPriorityClass(h, D3DKMT_SCHEDULINGPRIORITYCLASS_HIGH);
            if (!verify) return;
            bool read = D3DKMTGetProcessSchedulingPriorityClass(h, out int now) >= 0;
            PlatformLog.Info(read && now >= D3DKMT_SCHEDULINGPRIORITYCLASS_HIGH
                ? "Capture GPU priority: high."
                : $"Capture GPU priority not raised (class {(read ? now : -1)}, NTSTATUS 0x{status:X8}); capture may lag while a game uses the whole GPU.");
        }
        catch (Exception ex)
        {
            // Missing export (Wine, very old Windows), exited process...: capture works without it.
            if (verify) PlatformLog.Info("Capture GPU priority unavailable: " + ex.Message);
        }
    }

    /// <summary>Low I/O priority (NtSetInformationProcess ProcessIoPriority, as Process Explorer uses) and low memory
    /// priority (its file cache pages go first) for a save. Never throws.</summary>
    public void LowerToBackground(Process process)
    {
        try
        {
            if (process.HasExited) return;
            var h = process.SafeHandle;
            int io = IoPriorityLow;
            int status = NtSetInformationProcess(h, ProcessIoPriority, ref io, sizeof(int));
            var mem = new MEMORY_PRIORITY_INFORMATION { MemoryPriority = MEMORY_PRIORITY_LOW };
            bool memOk = SetProcessInformation(h, ProcessMemoryPriority, ref mem, (uint)Marshal.SizeOf<MEMORY_PRIORITY_INFORMATION>());
            if ((status < 0 || !memOk) && Interlocked.Exchange(ref _backgroundWarned, 1) == 0)
                PlatformLog.Info($"Save priority: disk {(status >= 0 ? "low" : $"unchanged (NTSTATUS 0x{status:X8})")}, " +
                                 $"memory {(memOk ? "low" : $"unchanged (Windows error {Marshal.GetLastWin32Error()})")}.");
        }
        catch (Exception ex)
        {
            if (Interlocked.Exchange(ref _backgroundWarned, 1) == 0)
                PlatformLog.Info("Save priority unavailable: " + ex.Message);
        }
    }

    /// <summary>True when the command line selects a software video encoder (judged from "-c:v lib...").</summary>
    private static bool UsesCpuEncoder(Process p)
    {
        try
        {
            var args = p.StartInfo.ArgumentList;
            for (int i = 0; i + 1 < args.Count; i++)
            {
                if ((args[i] == "-c:v" || args[i] == "-vcodec" || args[i] == "-codec:v") &&
                    args[i + 1].StartsWith("lib", StringComparison.Ordinal))
                    return true;
            }
        }
        catch (Exception)
        {
            // StartInfo is not available for processes we did not start.
        }
        return false;
    }

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION // x64: 64 bytes
    {
        public long PerProcessUserTimeLimit;   // @0
        public long PerJobUserTimeLimit;       // @8
        public uint LimitFlags;                // @16 (+4 padding)
        public UIntPtr MinimumWorkingSetSize;  // @24
        public UIntPtr MaximumWorkingSetSize;  // @32
        public uint ActiveProcessLimit;        // @40 (+4 padding)
        public UIntPtr Affinity;               // @48
        public uint PriorityClass;             // @56
        public uint SchedulingClass;           // @60
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS // 48 bytes
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION // x64: 144 bytes
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateJobObjectW(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(SafeFileHandle hJob, int infoClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint cbInfo);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(SafeFileHandle hJob, IntPtr hProcess);

    private const int D3DKMT_SCHEDULINGPRIORITYCLASS_HIGH = 4; // IDLE 0 .. NORMAL 2 .. HIGH 4, REALTIME 5 (never)

    [DllImport("gdi32.dll", ExactSpelling = true)]
    private static extern int D3DKMTSetProcessSchedulingPriorityClass(SafeProcessHandle hProcess, int priority);

    [DllImport("gdi32.dll", ExactSpelling = true)]
    private static extern int D3DKMTGetProcessSchedulingPriorityClass(SafeProcessHandle hProcess, out int priority);

    private const int ProcessIoPriority = 33;  // PROCESSINFOCLASS
    private const int IoPriorityLow = 1;       // VeryLow 0, Low 1, Normal 2
    private const int ProcessMemoryPriority = 0; // PROCESS_INFORMATION_CLASS
    private const uint MEMORY_PRIORITY_LOW = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORY_PRIORITY_INFORMATION
    {
        public uint MemoryPriority;
    }

    [DllImport("ntdll.dll", ExactSpelling = true)]
    private static extern int NtSetInformationProcess(SafeProcessHandle hProcess, int infoClass, ref int info, int length);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessInformation(SafeProcessHandle hProcess, int infoClass,
        ref MEMORY_PRIORITY_INFORMATION info, uint size);
}
