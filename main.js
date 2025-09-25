const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'assets', 'icon.icns'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  // Debug için Developer Tools'u aç
  //mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Klasör seçme dialog'u
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!result.canceled) {
    const folderPath = result.filePaths[0];
    const imageFiles = fs.readdirSync(folderPath)
      .filter(file => /\.(jpg|jpeg|png|bmp|gif)$/i.test(file))
      .map(file => path.join(folderPath, file));

    return { folderPath, imageFiles };
  }
  return null;
});

// Export fonksiyonu - dosya kaydetme
ipcMain.handle('save-file', async (event, data, fileName, fileExtension) => {
  const filters = [];

  // Set up file filters based on extension
  switch (fileExtension) {
    case 'json':
      filters.push({ name: 'JSON Files', extensions: ['json'] });
      break;
    case 'txt':
      filters.push({ name: 'Text Files', extensions: ['txt'] });
      break;
    case 'xml':
      filters.push({ name: 'XML Files', extensions: ['xml'] });
      break;
    case 'zip':
      filters.push({ name: 'ZIP Files', extensions: ['zip'] });
      break;
    default:
      filters.push({ name: 'All Files', extensions: ['*'] });
  }

  filters.push({ name: 'All Files', extensions: ['*'] });

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: fileName,
    filters: filters
  });

  if (!result.canceled) {
    try {
      // Ensure the file has the correct extension
      let filePath = result.filePath;
      if (!filePath.endsWith(`.${fileExtension}`)) {
        filePath += `.${fileExtension}`;
      }

      // Handle different data types
      if (fileExtension === 'zip') {
        // For ZIP files, data is a Buffer
        fs.writeFileSync(filePath, data);
      } else {
        // For text files (JSON, XML, TXT)
        fs.writeFileSync(filePath, data, 'utf8');
      }
      return { success: true, path: filePath };
    } catch (error) {
      console.error('File save error:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, canceled: true };
});