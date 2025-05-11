const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const games = {};

function initializeBoard() {
  // 8x8, FEN: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR
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
      // assign player
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
      // notify both players
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
      if (fx === tx && fy === ty) return send(ws, 'ERROR', { message: 'Не можна ходити на ту ж саму клітинку.' });
      const piece = game.board[fx][fy];
      if (!piece) return send(ws, 'ERROR', { message: 'No piece at from.' });
      const target = game.board[tx][ty];
      const isWhite = piece === piece.toUpperCase();
      if (target && ((isWhite && target === target.toUpperCase()) || (!isWhite && target === target.toLowerCase()))) {
        return send(ws, 'ERROR', { message: 'Не можна бити свою фігуру.' });
      }
      if (piece.toLowerCase() === 'p') {
        const dir = isWhite ? -1 : 1;
        if (fy === ty && tx - fx === dir && !target) {
          // ok
        } else if (fy === ty && ((isWhite && fx === 6 && tx === 4) || (!isWhite && fx === 1 && tx === 3)) && !target && !game.board[fx + dir][fy]) {
          // перший хід на 2 клітинки
        } else if (Math.abs(ty - fy) === 1 && tx - fx === dir && target && ((isWhite && target === target.toLowerCase()) || (!isWhite && target === target.toUpperCase()))) {
          // взяття по діагоналі
        } else {
          return send(ws, 'ERROR', { message: 'Невалідний хід пішака.' });
        }
        // Перевірка на промоцію
        if ((isWhite && tx === 0) || (!isWhite && tx === 7)) {
          // Зберігаємо стан очікування промоції
          game.pendingPromotion = { x: tx, y: ty, color: playerColor, from: [fx, fy], to: [tx, ty] };
          // Поки не оновлюємо дошку, чекаємо вибору
          send(ws, 'AWAIT_PROMOTION_CHOICE', { square: [tx, ty] });
          return;
        }
      }
      // TODO: Додати валідацію для інших фігур
      game.board[tx][ty] = piece;
      game.board[fx][fy] = '';
      game.currentPlayer = getOpponentColor(game.currentPlayer);
      game.players.forEach(p => p && send(p.ws, 'GAME_UPDATED', { board: game.board, currentPlayer: game.currentPlayer }));
    } else if (type === 'CHOOSE_PROMOTION') {
      const { piece: promoteTo } = payload;
      const gameId = ws.gameId;
      const game = games[gameId];
      if (!game || !game.pendingPromotion) return send(ws, 'ERROR', { message: 'No pending promotion.' });
      const { x, y, color, from, to } = game.pendingPromotion;
      const playerIdx = getPlayerIndex(game, ws);
      if (playerIdx === -1 || game.players[playerIdx].color !== color) return send(ws, 'ERROR', { message: 'Not your promotion.' });
      // Визначаємо фігуру для промоції
      let newPiece = promoteTo;
      if (!['q','r','b','n'].includes(promoteTo)) newPiece = 'q';
      if (color === 'white') newPiece = newPiece.toUpperCase();
      else newPiece = newPiece.toLowerCase();
      // Оновлюємо дошку
      game.board[from[0]][from[1]] = '';
      game.board[to[0]][to[1]] = newPiece;
      game.currentPlayer = getOpponentColor(game.currentPlayer);
      delete game.pendingPromotion;
      game.players.forEach(p => p && send(p.ws, 'GAME_UPDATED', { board: game.board, currentPlayer: game.currentPlayer }));
    }
  });

  ws.on('close', () => {
    // Позначити гравця як відключеного, але не видаляти гру
    if (ws.gameId && games[ws.gameId]) {
      const game = games[ws.gameId];
      const idx = getPlayerIndex(game, ws);
      if (idx !== -1) game.players[idx] = null;
      // Повідомити іншого гравця
      game.players.forEach(p => p && send(p.ws, 'OPPONENT_DISCONNECTED', {}));
    }
  });
});

server.on('request', (req, res) => {
  // Serve static files from /public
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server started on port', PORT);
}); 