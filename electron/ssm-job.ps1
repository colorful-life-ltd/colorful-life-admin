# Private supervisor: own job handle, direct AWS child assigned before readiness.
# EOF from Electron (including a crash) closes the job and its owned descendants.
$ErrorActionPreference = 'Stop'
$job = [IntPtr]::Zero
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TunnelJob {
 [StructLayout(LayoutKind.Sequential)] public struct Basic { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWS, MaxWS; public uint ActiveLimit; public UIntPtr Affinity; public uint Priority, Scheduling; }
 [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
 [StructLayout(LayoutKind.Sequential)] public struct Extended { public Basic Basic; public IO IO; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attrs, string name);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int type, ref Extended data, uint size);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
 public static IntPtr Create() {
  var job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero)throw new Exception("job");
  var data=new Extended();data.Basic.Flags=0x2000; // KILL_ON_JOB_CLOSE
  if(!SetInformationJobObject(job,9,ref data,(uint)Marshal.SizeOf(data))){CloseHandle(job);throw new Exception("limits");}
  return job;
 }
 public static void Attach(IntPtr job, IntPtr process) {
  bool inside; if(!IsProcessInJob(process,job,out inside))throw new Exception("query");
  if(!inside && !AssignProcessToJobObject(job,process))throw new Exception("assign");
 }
}
'@
$job = [TunnelJob]::Create()
[Console]::Out.WriteLine('JOB_READY')
$inputLine = [Console]::In.ReadLine()
if ($null -eq $inputLine) { exit 0 }
$request = $inputLine | ConvertFrom-Json
$rootProcess = [Diagnostics.Process]::GetProcessById([int]$request.pid)
# Bind the actual process handle and creation time, not a name or a recycled PID.
$started = $rootProcess.StartTime.ToUniversalTime()
$minimum = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$request.startedAfter).UtcDateTime
if ($started -lt $minimum.AddSeconds(-2) -or $rootProcess.HasExited) { throw 'identity' }
[TunnelJob]::Attach($job, $rootProcess.Handle)
# Future children inherit the job. Also capture any child launched before assignment.
function Attach-ExistingChildren([int]$parentId, [DateTime]$parentStarted) {
 foreach ($entry in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $parentId")) {
  try { $child = [Diagnostics.Process]::GetProcessById([int]$entry.ProcessId) } catch { continue }
  try {
   if ($child.StartTime.ToUniversalTime() -lt $parentStarted -or $child.HasExited) { continue }
   [TunnelJob]::Attach($job, $child.Handle)
   Attach-ExistingChildren $child.Id ($child.StartTime.ToUniversalTime())
  } finally { $child.Dispose() }
 }
}
Attach-ExistingChildren $rootProcess.Id $started
[Console]::Out.WriteLine('OWNED')
$null = [Console]::In.ReadLine()
} catch {
 [Console]::Error.WriteLine('Tunnel process supervision unavailable.')
 exit 1
} finally {
 if ($job -ne [IntPtr]::Zero) { $null = [TunnelJob]::CloseHandle($job) }
}
