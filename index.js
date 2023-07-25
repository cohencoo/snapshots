const { app, screen, dialog, Menu, Tray, Notification, BrowserWindow } = require("electron")
const path = require("path")
const fs = require("fs")
const { exec } = require("child_process")

if (require("electron-squirrel-startup")) app.quit()

let tray = null
let interval = 4
let maxScreenshots = 600
let isRunning = false
let snapshotWindow = null
let snapshotInterval = null

const openSnapshotWindow = () => {
    if (snapshotWindow) {
        snapshotWindow.show()
        return
    }
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    const windowWidth = 1200
    const windowHeight = 800

    snapshotWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: Math.floor((width - windowWidth) / 2),
        y: Math.floor((height - windowHeight) / 2),
        titleBarStyle: "hidden",
        webPreferences: { nodeIntegration: true },
    })

    snapshotWindow.loadFile("index.html")
    snapshotWindow.on("close", (e) => {
        e.preventDefault()
        snapshotWindow.hide()
    })
    snapshotWindow.on("closed", () => (snapshotWindow = null))
}

const takeSnapshot = () => {
    const screenshotsDir = path.join(app.getAppPath(), "snapshots")
    fs.mkdirSync(screenshotsDir, { recursive: true })

    const screenshotPath = path.join(screenshotsDir, `${Math.floor(Date.now() / 1000)}.jpg`)
    const command = `screencapture -x "${screenshotPath}" && sips -s format jpeg "${screenshotPath}" --out "${screenshotPath}"`
    exec(command, (error, stdout, stderr) => {
        if (error) {
            clearInterval(snapshotInterval)
            new Notification({
                title: "Snapshots",
                subtitle: "Failed to capture screenshot",
                body: error,
            }).show()
        }
    })
}

const removeOldScreenshots = () => {
    const screenshotsDir = path.join(app.getAppPath(), "snapshots")
    const screenshotFiles = fs.readdirSync(screenshotsDir).sort()
    const numScreenshots = screenshotFiles.length

    if (numScreenshots > maxScreenshots) {
        const numToRemove = numScreenshots - maxScreenshots
        const screenshotsToRemove = screenshotFiles.slice(0, numToRemove)
        screenshotsToRemove.forEach((file) => {
            fs.unlinkSync(path.join(screenshotsDir, file))
        })
    }

    const indexedFilePath = path.join(screenshotsDir, "indexed.txt")
    fs.writeFileSync(indexedFilePath, screenshotFiles.join("\n"))
}

const startSnapshotInterval = () => {
    stopSnapshotInterval()
    snapshotInterval = setInterval(() => {
        takeSnapshot()
        removeOldScreenshots()
    }, interval * 1000)
}

const stopSnapshotInterval = () => {
    clearInterval(snapshotInterval)
    snapshotInterval = null
}

const updateSnapshotInterval = () => {
    if (isRunning) {
        startSnapshotInterval()
    }
}

const updateTrayMenu = () => {
    const calcTime = Math.trunc((maxScreenshots * interval) / 60)
    const startStopLabel = isRunning ? "🟠 Pause Snapshots" : "🟢 Start Snapshots"

    const intervalSubMenu = [
        { label: "1 second", value: 1 },
        { label: "4 seconds", value: 4 },
        { label: "8 seconds", value: 8 },
        { label: "15 seconds", value: 15 },
        { label: "30 seconds", value: 30 },
    ]

    const maxScreenshotsSubMenu = [
        { label: "100", value: 100 },
        { label: "600", value: 600 },
        { label: "1200", value: 1200 },
        { label: "1500", value: 1500 },
        { label: "2000", value: 2000 },
    ]

    const intervalSubMenuTemplate = intervalSubMenu.map((item) => ({
        label: item.label,
        type: "radio",
        checked: interval === item.value,
        click: () => {
            interval = item.value
            updateTrayMenu()
            updateSnapshotInterval()
        },
    }))

    const maxScreenshotsSubMenuTemplate = maxScreenshotsSubMenu.map((item) => ({
        label: item.label,
        type: "radio",
        checked: maxScreenshots === item.value,
        click: () => {
            maxScreenshots = item.value
            updateTrayMenu()
        },
    }))

    const contextMenu = Menu.buildFromTemplate([
        {
            label: "⏭️ Next",
            click: () => {
                const command = `osascript -e 'tell application "Spotify" to next track'`
                exec(command, (error, stdout, stderr) => {})
            },
        },
        { label: "Snapshots v2.0", enabled: false },
        { label: `Snapshot coverage: ${calcTime} minutes`, enabled: false },
        { type: "separator" },
        {
            label: `Interval: ${interval} seconds`,
            id: "interval",
            submenu: intervalSubMenuTemplate,
        },
        {
            label: `Max Screenshots: ${maxScreenshots}`,
            id: "maxScreenshots",
            submenu: maxScreenshotsSubMenuTemplate,
        },
        {
            label: `Management`,
            submenu: [
                {
                    label: "Delete All Snapshots",
                    click: () => {
                        const screenshotsDir = path.join(app.getAppPath(), "snapshots")
                        if (fs.existsSync(screenshotsDir)) {
                            const screenshotFiles = fs.readdirSync(screenshotsDir)
                            const numScreenshots = screenshotFiles.length
                            const options = {
                                type: "question",
                                buttons: ["Cancel", "Delete"],
                                defaultId: 0,
                                title: "Delete Snapshots",
                                message: `Are you sure you want to delete ${numScreenshots} screenshots?`,
                            }
                            const response = dialog.showMessageBoxSync(options)
                            if (response === 1) fs.rmSync(screenshotsDir, { recursive: true })
                        }
                    },
                },
                {
                    label: "Quit App",
                    click: () => app.exit(),
                },
            ],
        },
        { type: "separator" },
        {
            label: "Browse Snapshots",
            click: openSnapshotWindow,
        },
        { type: "separator" },
        {
            label: startStopLabel,
            click: () => {
                if (isRunning) {
                    new Notification({
                        title: "Snapshots",
                        subtitle: "Snapshotting paused",
                    }).show()
                    stopSnapshotInterval()
                } else {
                    new Notification({
                        title: "Snapshots",
                        subtitle: `Snapshotting started. Capturing every ${interval}s (${calcTime} minute${
                            calcTime > 1 ? "s" : ""
                        } of coverage)`,
                    }).show()

                    startSnapshotInterval()
                }
                isRunning = !isRunning
                updateTrayMenu()
            },
        },
    ])

    tray.setContextMenu(contextMenu)
}

app.on("ready", () => {
    tray = new Tray(path.join(__dirname, "snapshots@2x.png"))
    app.dock.hide()
    updateTrayMenu()
})
