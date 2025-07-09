// ETWConsumerEnumerator.js
// Lists all ETW sessions and their consumer process IDs

"use strict";

function initializeScript() {
    return [
        new host.apiVersionSupport(1, 7),
        new host.functionAlias(enumerateETWConsumers, "etw_consumers"),
    ];
}

function enumerateETWConsumers() {
    let output = [];
    
    try {
        // Get all WMI logger contexts using !wmitrace.strdump
        let result = host.namespace.Debugger.Utility.Control.ExecuteCommand("!wmitrace.strdump");
        
        // The result is an object, we need to iterate through it
        for (let line of result) {
            let lineStr = line.toString();
            
            // Look for logger context lines
            let match = lineStr.match(/Logger\s+Id\s+0x([0-9a-fA-F]+)\s+@\s+(0x[0-9a-fA-F]+)\s+Named\s+'(.*)'/);
            
            if (match) {
                let loggerId = parseInt(match[1], 16);
                let contextAddr = match[2];
                let loggerName = match[3];
                
                host.diagnostics.debugLog(`Found logger: ${loggerName} (ID: ${loggerId}) at ${contextAddr}\n`);
                processLoggerContext(contextAddr, loggerId, loggerName, output);
            }
        }
        
        // Print results
        printResults(output);
        
    } catch (e) {
        host.diagnostics.debugLog(`Error: ${e}\n`);
        host.diagnostics.debugLog(`Stack: ${e.stack}\n`);
    }
}

function processLoggerContext(contextAddr, loggerId, loggerName, output) {
    try {
        let addr = host.parseInt64(contextAddr);
        
        // Create typed object for WMI_LOGGER_CONTEXT
        let loggerContext = host.createTypedObject(
            addr,
            "nt",
            "_WMI_LOGGER_CONTEXT"
        );
        
        let sessionInfo = {
            address: contextAddr,
            loggerId: loggerId,
            loggerName: loggerName,
            consumers: []
        };
        
        // Check consumers - at offset 0x158 for Consumers LIST_ENTRY, 0x168 for NumConsumers
        let numConsumers = loggerContext.NumConsumers;
        
        host.diagnostics.debugLog(`  NumConsumers: ${numConsumers}\n`);
        
        if (numConsumers > 0) {
            // Get the Consumers LIST_ENTRY
            let consumersList = loggerContext.Consumers;
            
            // Check if the list is not empty (Flink != list head address)
            let listHeadAddr = addr.add(0x158); // Offset of Consumers field
            
            // Keep addresses as host.parseInt64 objects to avoid precision loss
            let flinkAddr = consumersList.Flink.address;
            
            host.diagnostics.debugLog(`  Consumer list Flink: ${flinkAddr.toString(16)}\n`);
            host.diagnostics.debugLog(`  List head: ${listHeadAddr.toString(16)}\n`);
            
            // compareTo returns 0 when equal, non-zero when different
            if (flinkAddr.compareTo(listHeadAddr) != 0) {
                host.diagnostics.debugLog(`  List is not empty, walking consumers...\n`);
                walkConsumerList(flinkAddr, listHeadAddr, sessionInfo.consumers, numConsumers);
            } else {
                host.diagnostics.debugLog(`  List is empty (Flink points to head)\n`);
            }
        }
        
        output.push(sessionInfo);
        
    } catch (e) {
        host.diagnostics.debugLog(`Error processing logger context ${contextAddr}: ${e}\n`);
        host.diagnostics.debugLog(`Stack trace: ${e.stack}\n`);
    }
}

function walkConsumerList(firstConsumerAddr, listHeadAddr, consumerList, maxConsumers) {
    let currentAddr = firstConsumerAddr;
    let count = 0;
    
    host.diagnostics.debugLog(`  Walking consumer list starting at ${currentAddr.toString(16)}\n`);
    
    while (count < maxConsumers) {
        try {
            // Check if we've looped back to the list head or hit null
            if (!currentAddr || currentAddr.compareTo(0) == 0 || currentAddr.compareTo(listHeadAddr) == 0) {
                host.diagnostics.debugLog(`    Reached end of list\n`);
                break;
            }
            
            host.diagnostics.debugLog(`    Examining consumer #${count + 1} at ${currentAddr.toString(16)}\n`);
            
            // First, let's check the ETW_REALTIME_CONSUMER structure
            host.diagnostics.debugLog(`    Checking ETW_REALTIME_CONSUMER structure...\n`);
            
            // Try to read the structure manually first
            let consumerData = host.memory.readMemoryValues(currentAddr, 8, 8); // Read first 64 bytes
            host.diagnostics.debugLog(`    First 8 QWORDs: ${consumerData.map(v => v.toString(16)).join(' ')}\n`);
            
            // Create ETW_REALTIME_CONSUMER object
            let consumer = host.createTypedObject(
                currentAddr,
                "nt",
                "_ETW_REALTIME_CONSUMER"
            );
            
            // Get process information
            let processObj = consumer.ProcessObject;
            let processAddr = processObj.address;
            host.diagnostics.debugLog(`    ProcessObject address: ${processAddr.toString(16)}\n`);
            
            if (processAddr && processAddr.compareTo(0) != 0) {
                // Try to get process info using !process command instead
                let processInfo = getProcessInfo(processAddr);
                
                if (processInfo) {
                    consumerList.push({
                        pid: processInfo.pid,
                        imageName: processInfo.imageName,
                        consumerAddr: currentAddr.toString(16),
                        eprocessAddr: processAddr.toString(16)
                    });
                    
                    host.diagnostics.debugLog(`    Found consumer: PID ${processInfo.pid} (${processInfo.imageName})\n`);
                } else {
                    host.diagnostics.debugLog(`    Could not get process info for ${processAddr.toString(16)}\n`);
                }
            } else {
                host.diagnostics.debugLog(`    No valid process object at this consumer\n`);
            }
            
            // Move to next consumer in the list
            let links = consumer.Links;
            let nextAddr = links.Flink.address;
            
            host.diagnostics.debugLog(`    Next address: ${nextAddr.toString(16)}\n`);
            
            // Check if we've completed the circular list
            if (nextAddr.compareTo(listHeadAddr) == 0) {
                host.diagnostics.debugLog(`    Reached list head, stopping\n`);
                break;
            }
            
            if (nextAddr.compareTo(firstConsumerAddr) == 0) {
                host.diagnostics.debugLog(`    Looped back to start, stopping\n`);
                break;
            }
            
            currentAddr = nextAddr;
            count++;
            
        } catch (e) {
            host.diagnostics.debugLog(`  Error walking consumer at ${currentAddr.toString(16)}: ${e}\n`);
            host.diagnostics.debugLog(`  Stack: ${e.stack}\n`);
            break;
        }
    }
    
    host.diagnostics.debugLog(`  Walked ${count} consumers, found ${consumerList.length} with valid processes\n`);
}

function getProcessInfo(eprocessAddr) {
    try {
        // Use !process command to get info
        let cmd = `!process ${eprocessAddr.toString(16)} 0`;
        let result = host.namespace.Debugger.Utility.Control.ExecuteCommand(cmd);
        
        let pid = 0;
        let imageName = "Unknown";
        
        // Parse the output
        for (let line of result) {
            let lineStr = line.toString();
            
            // Look for PID
            let pidMatch = lineStr.match(/PROCESS\s+[0-9a-fA-F]+.*Cid:\s+([0-9a-fA-F]+)/);
            if (pidMatch) {
                pid = parseInt(pidMatch[1], 16);
            }
            
            // Look for image name
            let imageMatch = lineStr.match(/Image:\s+(.+)/);
            if (imageMatch) {
                imageName = imageMatch[1].trim();
            }
        }
        
        if (pid > 0) {
            return { pid: pid, imageName: imageName };
        }
        
        // Alternative: try to read EPROCESS fields directly
        host.diagnostics.debugLog(`      Trying direct EPROCESS read...\n`);
        
        // Create EPROCESS object
        let eprocess = host.createTypedObject(
            eprocessAddr,
            "nt",
            "_EPROCESS"
        );
        
        // Try different ways to get PID
        try {
            // Common offsets for UniqueProcessId in EPROCESS
            // Windows 10/11: usually around 0x440 or 0x2E8
            let pidOffsets = [0x2E8, 0x440, 0x448, 0x2E0];
            
            for (let offset of pidOffsets) {
                try {
                    let pidValue = host.memory.readMemoryValues(
                        eprocessAddr.add(offset),
                        1,
                        8  // Read as 8-byte value
                    )[0];
                    
                    if (pidValue > 0 && pidValue < 100000) {
                        pid = Number(pidValue);
                        host.diagnostics.debugLog(`      Found PID ${pid} at offset 0x${offset.toString(16)}\n`);
                        break;
                    }
                } catch (e) {
                    // Try next offset
                }
            }
        } catch (e) {
            host.diagnostics.debugLog(`      Error reading PID: ${e}\n`);
        }
        
        // Try to get image name
        try {
            // ImageFileName is usually at offset 0x5A8 or 0x450
            let nameOffsets = [0x5A8, 0x450, 0x468];
            
            for (let offset of nameOffsets) {
                try {
                    let nameBytes = host.memory.readMemoryValues(
                        eprocessAddr.add(offset),
                        15,  // ImageFileName is 15 bytes
                        1    // Read as bytes
                    );
                    
                    let name = "";
                    for (let byte of nameBytes) {
                        if (byte == 0) break;
                        name += String.fromCharCode(byte);
                    }
                    
                    if (name.length > 0) {
                        imageName = name;
                        host.diagnostics.debugLog(`      Found image name '${imageName}' at offset 0x${offset.toString(16)}\n`);
                        break;
                    }
                } catch (e) {
                    // Try next offset
                }
            }
        } catch (e) {
            host.diagnostics.debugLog(`      Error reading image name: ${e}\n`);
        }
        
        if (pid > 0) {
            return { pid: pid, imageName: imageName };
        }
        
        return null;
        
    } catch (e) {
        host.diagnostics.debugLog(`      Error getting process info: ${e}\n`);
        return null;
    }
}

function printResults(output) {
    host.diagnostics.debugLog("\n===== ETW Sessions and Consumers =====\n\n");
    
    let sessionsWithConsumers = 0;
    let totalConsumers = 0;
    
    for (let session of output) {
        if (session.consumers.length > 0) {
            sessionsWithConsumers++;
            totalConsumers += session.consumers.length;
            
            host.diagnostics.debugLog(`Session: ${session.loggerName} (ID: 0x${session.loggerId.toString(16)})\n`);
            host.diagnostics.debugLog(`Logger Context: ${session.address}\n`);
            host.diagnostics.debugLog(`Consumers (${session.consumers.length}):\n`);
            
            for (let consumer of session.consumers) {
                host.diagnostics.debugLog(`  - PID: ${consumer.pid} (${consumer.imageName})\n`);
                host.diagnostics.debugLog(`    Consumer: 0x${consumer.consumerAddr}, EPROCESS: 0x${consumer.eprocessAddr}\n`);
            }
            
            host.diagnostics.debugLog("\n");
        }
    }
    
    host.diagnostics.debugLog(`\nSummary:\n`);
    host.diagnostics.debugLog(`Total sessions: ${output.length}\n`);
    host.diagnostics.debugLog(`Sessions with consumers: ${sessionsWithConsumers}\n`);
    host.diagnostics.debugLog(`Total consumers: ${totalConsumers}\n`);
}
