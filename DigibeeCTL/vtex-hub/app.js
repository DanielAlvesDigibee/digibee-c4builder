const { spawn, exec } = require("node:child_process");
const readline = require("readline");
const replaceGlobals = require("./replace-globals");
const extractPipelineData = require("./pipeline-navigator");
const generatePUML = require("./generate-puml");

function openLocalHost() {
    const url = "http://localhost:3000";

    let command;

    switch (process.platform) {
        case "darwin":
            // macOS
            command = `open "${url}"`;
            break;
        case "win32":
            // Windows
            command = `start "" "${url}"`;
            break;
        default:
            // Linux and other platforms
            command = `xdg-open "${url}"`;
            break;
    }

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error opening URL: ${error.message}`);
            return;
        }
        console.log("URL opened successfully.");
    });
}

//run bash script
const getAllPipesInfo = spawn("bash", ["digibeectl_interpreter.sh", "-a"]);

// Print bash script echo data
getAllPipesInfo.stdout.on("data", (data) => {
    process.stdout.write(data.toString());
});

// Print eventual errors
getAllPipesInfo.stderr.on("error", (err) => {
    process.stdout.write(err + "\n");
});

// Run this after the bash script finished
getAllPipesInfo.stdout.on("close", async (code) => {
    process.stdout.write("\nProcess exited with code: " + code + "\n");

    let success = false;

    process.stdout.write("\nWill replace globals\n\n");
    success = await replaceGlobals();
    if (success) {
        process.stdout.write("\nGlobals replaced.\n\n");
    } else {
        process.stdout.write("Error occurred while replacing globals.\n");
        return;
    }

    process.stdout.write("\nWill extract data from pipelines\n\n");
    success = await extractPipelineData();

    if (success) {
        process.stdout.write("\nData extracted.\n\n");
    } else {
        process.stdout.write( "Error occurred while extracting data.\n" );
        return;
    }

    process.stdout.write("\nWill generate PUML file\n\n");
    success = await generatePUML();

    if (success) {
        process.stdout.write( "\nPUML generated.\n\n" );
        console.log( "Will build server on localhost:3000." );
        openLocalHost();
        const c4builder = exec("c4builder site -w");
        
        // Print bash script echo data
        c4builder.stdout.on("data", (data) => {
            process.stdout.write(data.toString());
        });
        
        // Print eventual errors
        c4builder.stderr.on("error", (err) => {
            process.stdout.write(err + "\n");
        });

    } else {
        process.stdout.write( "Error occurred while generating PUML.\n" );
        return;
    }
});

// Create an interface to read user input from the terminal
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// Prompt the user for input
rl.question("", (userInput) => {
    // Send user input to the child process
    getAllPipesInfo.stdin.write(userInput + "\n");
    getAllPipesInfo.stdin.end(); // End the input stream

    // Close the readline interface when done
    rl.close();
});
