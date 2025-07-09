# ETW-DBG-ENUM
Enumerates all ETW sessions from kernel structures

Summary of what the Script Does

The script successfully:
- Enumerates all ETW sessions from kernel structures 	•	Walks the consumer linked lists for each session 	•	Extracts PID and process name from EPROCESS structures 	•	Shows the relationships between ETW sessions and their consumers
Potential Use Cases
This technique is useful for:
- Security Analysis: Identifying which processes are monitoring specific ETW sessions 	•	Debugging: Understanding ETW consumer relationships when troubleshooting 	•	System Analysis: Mapping out the complete ETW consumer landscape 	•	Forensics: Discovering hidden or unexpected ETW consumers

### Usage
```
.scriptload path\to\etw-ennum-windbg.js
!etw_consumers
```

### Example output snippet
```
===== ETW Sessions and Consumers =====

Session: Eventlog-Security (ID: 0x3)
Logger Context: 0xFFFFD8075DFE5540
Consumers (1):
  - PID: 1140 (svchost.exe)
    Consumer: 0xffffd80764684e80, EPROCESS: 0xffffd8076466b080

Session: DiagLog (ID: 0x6)
Logger Context: 0xFFFFD8075DFE1A40
Consumers (1):
  - PID: 3216 (svchost.exe)
    Consumer: 0xffffd80764ed4940, EPROCESS: 0xffffd80764e47080

Session: Diagtrack-Listener (ID: 0x7)
Logger Context: 0xFFFFD8075DFE2A40
Consumers (1):
  - PID: 3196 (svchost.exe)
    Consumer: 0xffffd80768e56950, EPROCESS: 0xffffd80764e42080

Session: SenseNdrEtw (ID: 0x24)
Logger Context: 0xFFFFD8076626F280
Consumers (1):
  - PID: 3936 (SenseNdr.exe)
    Consumer: 0xffffd80768e5d280, EPROCESS: 0xffffd80768c06080
```

### Quick Reference Commands
```
# List all ETW sessions
!wmitrace.strdump

# Examine a specific logger context
dt nt!_WMI_LOGGER_CONTEXT <address>

# Check ETW providers
!wmitrace.loggerproviders <logger_id>

# See ETW buffer information
!wmitrace.loggerdump <logger_id>
 ```
