$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class GdProcessTree {
    private const uint SnapshotProcesses = 0x00000002;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct ProcessEntry {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId;
        public uint Threads;
        public uint ParentProcessId;
        public int BasePriority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static int[] Descendants(int rootProcessId) {
        var children = new Dictionary<int, List<ProcessEntry>>();
        IntPtr snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        if (snapshot == new IntPtr(-1)) return new int[0];
        try {
            var entry = new ProcessEntry();
            entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            if (Process32First(snapshot, ref entry)) {
                do {
                    int parent = (int)entry.ParentProcessId;
                    List<ProcessEntry> entries;
                    if (!children.TryGetValue(parent, out entries)) {
                        entries = new List<ProcessEntry>();
                        children[parent] = entries;
                    }
                    entries.Add(entry);
                    entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
                } while (Process32Next(snapshot, ref entry));
            }
        } finally {
            CloseHandle(snapshot);
        }

        var result = new List<int>();
        var pending = new Queue<int>();
        pending.Enqueue(rootProcessId);
        while (pending.Count > 0) {
            int parent = pending.Dequeue();
            List<ProcessEntry> entries;
            if (!children.TryGetValue(parent, out entries)) continue;
            foreach (ProcessEntry entry in entries) {
                int processId = (int)entry.ProcessId;
                pending.Enqueue(processId);
                if (!String.Equals(entry.ExeFile, "conhost.exe", StringComparison.OrdinalIgnoreCase)) {
                    result.Add(processId);
                }
            }
        }
        return result.ToArray();
    }
}
"@

[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
$rootLine = [Console]::In.ReadLine()
if ($null -eq $rootLine) { exit 0 }
$rootProcessId = [int]$rootLine
$action = [Console]::In.ReadLine()
if ($action -ne 'kill') { exit 0 }
$targets = [GdProcessTree]::Descendants($rootProcessId)
for ($index = $targets.Length - 1; $index -ge 0; $index--) {
    Stop-Process -Id $targets[$index] -Force -ErrorAction SilentlyContinue
}
Stop-Process -Id $rootProcessId -Force -ErrorAction SilentlyContinue
