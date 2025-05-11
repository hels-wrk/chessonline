const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
let websocket;
let playerColor = null;
let currentBoardState = null;
let currentPlayer = null;
let selectedStyleBoard = localStorage.getItem('boardStyle') || 'classic';
let selectedStylePieces = localStorage.getItem('pieceStyle') || 'flat';

const gameIdInput = document.getElementById('gameIdInput');
const createGameButton = document.getElementById('createGameButton');
const joinGameButton = document.getElementById('joinGameButton');
const messageArea = document.getElementById('messageArea');
const chessBoardContainer = document.getElementById('chessBoardContainer');
const promotionModal = document.getElementById('promotionModal');

function connectWebSocket() {
  websocket = new WebSocket(WS_URL.replace(/^http/, 'ws'));
  websocket.onopen = () => displayMessage('З’єднання встановлено', 'info');
  websocket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };
  websocket.onclose = () => displayMessage('З’єднання втрачено', 'error');
}

function displayMessage(text, type = 'info') {
  messageArea.textContent = text;
  messageArea.style.color = type === 'error' ? '#c00' : '#333';
}

function send(type, payload) {
  websocket.send(JSON.stringify({ type, payload }));
}

createGameButton.onclick = () => {
  if (!websocket || websocket.readyState !== 1) connectWebSocket();
  send('CREATE_GAME', { gameId: gameIdInput.value.trim() });
};
joinGameButton.onclick = () => {
  if (!websocket || websocket.readyState !== 1) connectWebSocket();
  send('JOIN_GAME', { gameId: gameIdInput.value.trim() });
};

function handleServerMessage(msg) {
  const { type, payload } = msg;
  if (type === 'GAME_CREATED' || type === 'GAME_JOINED') {
    playerColor = payload.color;
    currentBoardState = payload.board;
    renderBoard(currentBoardState, playerColor);
    displayMessage('Очікування суперника...');
  } else if (type === 'GAME_UPDATED') {
    currentBoardState = payload.board;
    currentPlayer = payload.currentPlayer;
    renderBoard(currentBoardState, playerColor);
    displayMessage(currentPlayer === playerColor ? 'Ваш хід' : 'Хід суперника');
    promotionModal.classList.add('hidden');
  } else if (type === 'ERROR') {
    displayMessage(payload.message, 'error');
  } else if (type === 'OPPONENT_DISCONNECTED') {
    displayMessage('Суперник відключився', 'error');
  } else if (type === 'AWAIT_PROMOTION_CHOICE') {
    showPromotionChoice(payload.square);
  }
}

function showPromotionChoice(square) {
  promotionModal.classList.remove('hidden');
  const buttons = promotionModal.querySelectorAll('.promotion-choices button');
  buttons.forEach(btn => {
    btn.onclick = () => {
      send('CHOOSE_PROMOTION', { piece: btn.dataset.piece });
      promotionModal.classList.add('hidden');
    };
  });
}

const unicodePieces = {
  'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
  'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟',
};

function renderBoard(board, color) {
  chessBoardContainer.innerHTML = '';
  chessBoardContainer.className = `board-${selectedStyleBoard}`;
  const isWhite = color === 'white';
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const x = isWhite ? i : 7 - i;
      const y = isWhite ? j : 7 - j;
      const square = document.createElement('div');
      square.className = 'square ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
      square.dataset.x = x;
      square.dataset.y = y;
      const piece = board[x][y];
      if (piece) {
        const pieceDiv = document.createElement('div');
        pieceDiv.className = `piece ${selectedStylePieces}`;
        pieceDiv.textContent = unicodePieces[piece] || piece;
        pieceDiv.dataset.x = x;
        pieceDiv.dataset.y = y;
        const isOwn = (playerColor === 'white' && piece === piece.toUpperCase()) || (playerColor === 'black' && piece === piece.toLowerCase());
        pieceDiv.draggable = isOwn && currentPlayer === playerColor;
        if (pieceDiv.draggable) pieceDiv.addEventListener('dragstart', onDragStart);
        square.appendChild(pieceDiv);
      }
      square.addEventListener('dragover', e => e.preventDefault());
      square.addEventListener('drop', onDrop);
      chessBoardContainer.appendChild(square);
    }
  }
}

let dragFrom = null;
function onDragStart(e) {
  dragFrom = { x: +e.target.dataset.x, y: +e.target.dataset.y };
}
function onDrop(e) {
  if (!dragFrom) return;
  const toX = +e.currentTarget.dataset.x;
  const toY = +e.currentTarget.dataset.y;
  send('MAKE_MOVE', { from: [dragFrom.x, dragFrom.y], to: [toX, toY] });
  dragFrom = null;
}

// Стилі дошки/фігур
[...document.querySelectorAll('.board-style')].forEach(btn => {
  btn.onclick = () => {
    selectedStyleBoard = btn.dataset.style;
    localStorage.setItem('boardStyle', selectedStyleBoard);
    if (currentBoardState) renderBoard(currentBoardState, playerColor);
  };
});
[...document.querySelectorAll('.piece-style')].forEach(btn => {
  btn.onclick = () => {
    selectedStylePieces = btn.dataset.style;
    localStorage.setItem('pieceStyle', selectedStylePieces);
    if (currentBoardState) renderBoard(currentBoardState, playerColor);
  };
});

// Підключення при першій дії
if (!websocket) connectWebSocket(); 