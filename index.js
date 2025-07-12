const { spawnSync, spawn } = require('child_process');
const { existsSync, writeFileSync } = require('fs');
const path = require('path');

// Configuration
const SESSION_ID = process.env.SESSION_ID || 'updateThis'; // Utilisez une variable d'environnement si possible
const LEVANTER_DIR = path.resolve('levanter');
const MAX_NODE_RESTARTS = 5;
const RESTART_WINDOW = 30000; // 30 secondes
let nodeRestartCount = 0;
let lastRestartTime = Date.now();

// Sécurisation de la création du fichier config.env
function writeConfigEnv() {
  const configPath = path.join(LEVANTER_DIR, 'config.env');
  const content = `VPS=true\nSESSION_ID=${SESSION_ID}`;
  try {
    writeFileSync(configPath, content, { flag: 'w' });
  } catch (err) {
    console.error('Erreur lors de l\'écriture de config.env:', err.message);
    process.exit(1);
  }
}

function startNode() {
  const child = spawn('node', ['index.js'], { cwd: LEVANTER_DIR, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code !== 0) {
      const currentTime = Date.now();
      if (currentTime - lastRestartTime > RESTART_WINDOW) nodeRestartCount = 0;
      lastRestartTime = currentTime;
      nodeRestartCount++;
      if (nodeRestartCount > MAX_NODE_RESTARTS) {
        console.error('Node.js redémarre en boucle. Arrêt des tentatives.');
        return;
      }
      console.log(`Node.js s'est arrêté avec le code ${code}. Redémarrage... (Tentative ${nodeRestartCount})`);
      startNode();
    }
  });
}

function startPm2() {
  const pm2 = spawn('yarn', ['pm2', 'start', 'index.js', '--name', 'levanter', '--attach'], {
    cwd: LEVANTER_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let restartCount = 0;
  const MAX_PM2_RESTARTS = 5;
  pm2.on('exit', (code) => {
    if (code !== 0) {
      startNode();
    }
  });
  pm2.on('error', (error) => {
    console.error('Erreur yarn pm2:', error.message);
    startNode();
  });
  if (pm2.stderr) {
    pm2.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('restart')) {
        restartCount++;
        if (restartCount > MAX_PM2_RESTARTS) {
          spawnSync('yarn', ['pm2', 'delete', 'levanter'], { cwd: LEVANTER_DIR, stdio: 'inherit' });
          startNode();
        }
      }
    });
  }
  if (pm2.stdout) {
    pm2.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output);
      if (output.includes('Connecting')) restartCount = 0;
    });
  }
}

function installDependencies() {
  const installResult = spawnSync(
    'yarn',
    ['install', '--force', '--non-interactive', '--network-concurrency', '3'],
    {
      cwd: LEVANTER_DIR,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
    }
  );
  if (installResult.error || installResult.status !== 0) {
    console.error('Échec de l\'installation des dépendances:', installResult.error ? installResult.error.message : 'Erreur inconnue');
    process.exit(1);
  }
}

function checkDependencies() {
  if (!existsSync(path.join(LEVANTER_DIR, 'package.json'))) {
    console.error('package.json introuvable !');
    process.exit(1);
  }
  const result = spawnSync('yarn', ['check', '--verify-tree'], {
    cwd: LEVANTER_DIR,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.log('Des dépendances sont manquantes ou mal installées.');
    installDependencies();
  }
}

function cloneRepository() {
  const cloneResult = spawnSync(
    'git',
    ['clone', 'https://github.com/lyfe00011/levanter.git', 'levanter'],
    { stdio: 'inherit' }
  );
  if (cloneResult.error) {
    console.error('Échec du clonage du dépôt:', cloneResult.error.message);
    process.exit(1);
  }
  writeConfigEnv();
  installDependencies();
}

// Initialisation
if (!existsSync(LEVANTER_DIR)) {
  cloneRepository();
  checkDependencies();
} else {
  checkDependencies();
}

startPm2();

// --- Serveur Express sécurisé ---
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();

// Sécurisation des headers HTTP
app.use(helmet());

// Limitation du nombre de requêtes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limite chaque IP à 100 requêtes par fenêtre
});
app.use(limiter);

// Route principale
app.get('/', (req, res) => {
  res.send('Bot is running!');
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
