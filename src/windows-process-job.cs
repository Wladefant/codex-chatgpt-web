using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

// The job handle is private to this supervisor. Closing it (even TerminateProcess) kills
// every descendant. Start suspended so the child cannot escape before job assignment.
internal static class WindowsProcessJob {
    [StructLayout(LayoutKind.Sequential)] struct StartupInfo {
        public int cb; public IntPtr reserved, desktop, title;
        public int x, y, xSize, ySize, xChars, yChars, fill, flags;
        public short show, reservedSize; public IntPtr reservedData, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
        public IntPtr process, thread; public uint processId, threadId;
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long processTime, jobTime; public uint flags;
        public UIntPtr minWorkingSet, maxWorkingSet; public uint activeProcesses;
        public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits basic; public IoCounters io;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttrs, IntPtr threadAttrs, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c); slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    static int Main(string[] args) {
        IntPtr parent = IntPtr.Zero, job = IntPtr.Zero;
        ProcessInfo child = new ProcessInfo();
        try {
            if (args.Length < 2) throw new ArgumentException("Expected parent PID and executable");
            parent = OpenProcess(0x00100000, false, uint.Parse(args[0])); // SYNCHRONIZE
            Check(parent != IntPtr.Zero);
            job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
            var limits = new ExtendedLimits(); limits.basic.flags = 0x00002000; // KILL_ON_JOB_CLOSE
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)));
            var startup = new StartupInfo(); startup.cb = Marshal.SizeOf(startup);
            startup.flags = 0x100; // STARTF_USESTDHANDLES
            startup.stdin = GetStdHandle(-10); startup.stdout = GetStdHandle(-11); startup.stderr = GetStdHandle(-12);
            foreach (var handle in new[] { startup.stdin, startup.stdout, startup.stderr }) {
                Check(SetHandleInformation(handle, 1, 1));
            }
            var command = new StringBuilder();
            for (int i = 1; i < args.Length; i++) { if (i > 1) command.Append(' '); command.Append(Quote(args[i])); }
            Check(CreateProcess(args[1], command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004, IntPtr.Zero, null, ref startup, out child));
            Check(AssignProcessToJobObject(job, child.process));
            Check(ResumeThread(child.thread) != uint.MaxValue);
            uint completed = WaitForMultipleObjects(2, new[] { parent, child.process }, false, uint.MaxValue);
            if (completed == 0) return 1; // parent died: finally closes the job
            Check(completed == 1);
            uint code; Check(GetExitCodeProcess(child.process, out code));
            return unchecked((int)code);
        } catch (Exception error) {
            Console.Error.WriteLine("Browser process supervisor: " + error.Message);
            return 1;
        } finally {
            // Also covers assignment failure while the root child is still suspended.
            if (child.process != IntPtr.Zero) TerminateProcess(child.process, 1);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
            if (child.process != IntPtr.Zero) CloseHandle(child.process);
            if (parent != IntPtr.Zero) CloseHandle(parent);
        }
    }
}
