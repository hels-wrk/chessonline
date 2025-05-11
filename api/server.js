const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const games = {};

function initializeBoard() {
  return [
    ['r','n','b','q','k','b','n','r'],
    ['p','p','p','p','p','p','p','p'],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['P','P','P','P','P','P','P','P'],
    ['R','N','B','Q','K','B','N','R']
  ];
}

function getOpponentColor(color) {
  return color === 'white' ? 'black' : 'white';
}

function getPlayerIndex(game, ws) {
  return game.players.findIndex(p => p && p.ws === ws);
}

function send(ws, type, payload) {
  ws.send(JSON.stringify({ type, payload }));
}

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }
    const { type, payload } = data;
    if (type === 'CREATE_GAME') {
      const { gameId } = payload;
      if (games[gameId] && games[gameId].players.filter(Boolean).length === 2) {
        send(ws, 'ERROR', { message: 'Game already full.' });
        return;
      }
      if (!games[gameId]) {
        games[gameId] = {
          board: initializeBoard(),
          currentPlayer: 'white',
          players: [null, null],
          castling: { white: { K: true, Q: true }, black: { K: true, Q: true } },
        };
      }
      if (!games[gameId].players[0]) {
        games[gameId].players[0] = { ws, color: 'white' };
        ws.gameId = gameId;
        ws.color = 'white';
        send(ws, 'GAME_CREATED', { gameId, color: 'white', board: games[gameId].board });
      } else if (!games[gameId].players[1]) {
        games[gameId].players[1] = { ws, color: 'black' };
        ws.gameId = gameId;
        ws.color = 'black';
        send(ws, 'GAME_CREATED', { gameId, color: 'black', board: games[gameId].board });
      }
    } else if (type === 'JOIN_GAME') {
      const { gameId } = payload;
      const game = games[gameId];
      if (!game) {
        send(ws, 'ERROR', { message: 'Game not found.' });
        return;
      }
      if (game.players.filter(Boolean).length === 2) {
        send(ws, 'ERROR', { message: 'Game already full.' });
        return;
      }
      if (!game.players[0]) {
        game.players[0] = { ws, color: 'white' };
        ws.color = 'white';
      } else if (!game.players[1]) {
        game.players[1] = { ws, color: 'black' };
        ws.color = 'black';
      }
      ws.gameId = gameId;
      send(ws, 'GAME_JOINED', { gameId, color: ws.color, board: game.board });
      game.players.forEach(p => p && send(p.ws, 'GAME_UPDATED', { board: game.board, currentPlayer: game.currentPlayer }));
    } else if (type === 'MAKE_MOVE') {
      const { from, to } = payload;
      const gameId = ws.gameId;
      const game = games[gameId];
      if (!game) return send(ws, 'ERROR', { message: 'Game not found.' });
      const playerIdx = getPlayerIndex(game, ws);
      if (playerIdx === -1) return send(ws, 'ERROR', { message: 'Not in this game.' });
      const playerColor = game.players[playerIdx].color;
      if (game.currentPlayer !== playerColor) return send(ws, 'ERROR', { message: 'Not your turn.' });
      const [fx, fy] = from, [tx, ty] = to;
      const piece = game.board[fx][fy];
      if (!piece) return send(ws, 'ERROR', { message: 'No piece at from.' });
      game.board[tx][ty] = piece;
      game.board[fx][fy] = '';
      game.currentPlayer = getOpponentColor(game.currentPlayer);
      game.players.forEach(p => p && send(p.ws, 'GAME_UPDATED', { board: game.board, currentPlayer: game.currentPlayer }));
    }
  });

  ws.on('close', () => {
    if (ws.gameId && games[ws.gameId]) {
      const game = games[ws.gameId];
      const idx = getPlayerIndex(game, ws);
      if (idx !== -1) game.players[idx] = null;
      game.players.forEach(p => p && send(p.ws, 'OPPONENT_DISCONNECTED', {}));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.on('request', (req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, '../public', filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    let ext = path.extname(filePath);
    let type = 'text/html';
    if (ext === '.css') type = 'text/css';
    if (ext === '.js') type = 'application/javascript';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});
server.listen(PORT, () => {
  console.log('Server started on port', PORT);
}); 