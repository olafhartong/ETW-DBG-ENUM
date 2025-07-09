# ETW-DBG-ENUM
Enumerates all ETW sessions from kernel structures

Summary of what the Script Does

The script successfully:
- Enumerates all ETW sessions from kernel structures 	•	Walks the consumer linked lists for each session 	•	Extracts PID and process name from EPROCESS structures 	•	Shows the relationships between ETW sessions and their consumers
Potential Use Cases
This technique is useful for:
- Security Analysis: Identifying which processes are monitoring specific ETW sessions 	•	Debugging: Understanding ETW consumer relationships when troubleshooting 	•	System Analysis: Mapping out the complete ETW consumer landscape 	•	Forensics: Discovering hidden or unexpected ETW consumers

Quick Reference Commands
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
