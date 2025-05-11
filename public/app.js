const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
let websocket;
let playerColor = null;
let currentBoardState = null;
let currentPlayer = null;
let selectedStyleBoard = localStorage.getItem('boardStyle') || 'classic';
let selectedStylePieces = localStorage.getItem('pieceStyle') || 'flat';
let isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let touchSelectedPiece = null;
let touchSelectedSquare = null;

const gameIdInput = document.getElementById('gameIdInput');
const createGameButton = document.getElementById('createGameButton');
const joinGameButton = document.getElementById('joinGameButton');
const messageArea = document.getElementById('messageArea');
const chessBoardContainer = document.getElementById('chessBoardContainer');
const promotionModal = document.getElementById('promotionModal');

function connectWebSocket() {
  websocket = new WebSocket(WS_URL.replace(/^http/, 'ws'));
  websocket.onopen = () => displayMessage("З'єднання встановлено", 'info');
  websocket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };
  websocket.onclose = () => displayMessage("З'єднання втрачено", 'error');
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
        
        // На ПК використовуємо нативне drag and drop
        if (isOwn && currentPlayer === playerColor && !isTouchDevice) {
          pieceDiv.draggable = true;
          pieceDiv.addEventListener('dragstart', onDragStart);
        }
        
        // На сенсорних пристроях використовуємо тач-події
        if (isOwn && currentPlayer === playerColor && isTouchDevice) {
          pieceDiv.addEventListener('touchstart', onTouchStart, { passive: false });
        }
        
        square.appendChild(pieceDiv);
      }
      
      // Звичайний drop для ПК
      square.addEventListener('dragover', e => e.preventDefault());
      square.addEventListener('drop', onDrop);
      
      // Тач-події для мобільних
      if (isTouchDevice) {
        square.addEventListener('touchend', onTouchEnd, { passive: false });
      }
      
      chessBoardContainer.appendChild(square);
    }
  }
}

let dragFrom = null;

function onDragStart(e) {
  dragFrom = { x: parseInt(e.target.dataset.x), y: parseInt(e.target.dataset.y) };
  e.dataTransfer.setData('text/plain', 'piece');
}

function onDrop(e) {
  e.preventDefault();
  if (!dragFrom) return;
  
  const toX = parseInt(e.currentTarget.dataset.x);
  const toY = parseInt(e.currentTarget.dataset.y);
  
  send('MAKE_MOVE', { from: [dragFrom.x, dragFrom.y], to: [toX, toY] });
  dragFrom = null;
}

// Функції для тач-подій
function onTouchStart(e) {
  e.preventDefault();
  const touchedPiece = e.target;
  
  // Очищаємо попередні виділення
  clearTouchSelection();
  
  // Виділяємо нову клітинку
  touchSelectedPiece = touchedPiece;
  touchSelectedSquare = touchedPiece.parentElement;
  touchSelectedSquare.classList.add('selected');
  
  // Показуємо візуальне виділення всіх клітинок, щоб було зрозуміло, що можна ходити
  if (isTouchDevice) {
    document.querySelectorAll('.square').forEach(sq => {
      if (sq !== touchSelectedSquare) {
        sq.classList.add('target');
      }
    });
  }
  
  // Зберігаємо позицію фігури, з якої починається хід
  dragFrom = { 
    x: parseInt(touchedPiece.dataset.x), 
    y: parseInt(touchedPiece.dataset.y) 
  };
}

function onTouchEnd(e) {
  e.preventDefault();
  
  if (!dragFrom || !touchSelectedPiece) return;
  
  // Знаходимо клітинку, на якій закінчився дотик
  const targetSquare = e.currentTarget;
  const toX = parseInt(targetSquare.dataset.x);
  const toY = parseInt(targetSquare.dataset.y);
  
  // Не дозволяємо робити хід на ту ж клітинку
  if (dragFrom.x === toX && dragFrom.y === toY) {
    clearTouchSelection();
    return;
  }
  
  // Надсилаємо хід на сервер
  send('MAKE_MOVE', { from: [dragFrom.x, dragFrom.y], to: [toX, toY] });
  
  // Очищаємо виділення і дані
  clearTouchSelection();
}

function clearTouchSelection() {
  // Прибираємо виділення з попередньої клітинки
  if (touchSelectedSquare) {
    touchSelectedSquare.classList.remove('selected');
  }
  
  // Очищаємо дані
  touchSelectedPiece = null;
  touchSelectedSquare = null;
  dragFrom = null;
  
  // Прибираємо виділення з усіх клітинок
  document.querySelectorAll('.square').forEach(sq => {
    sq.classList.remove('selected');
    sq.classList.remove('target');
  });
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

// Додаємо обробник для блокування масштабування сторінки для мобільних пристроїв
document.addEventListener('touchmove', function(e) {
  if (e.touches.length > 1 || dragFrom) {
    e.preventDefault();
  }
}, { passive: false });

document.addEventListener('touchstart', function(e) {
  if (e.touches.length > 1) {
    e.preventDefault();
  }
}, { passive: false });

// Запобігання скролу під час гри на мобільних
chessBoardContainer.addEventListener('touchmove', function(e) {
  if (dragFrom) {
    e.preventDefault();
  }
}, { passive: false });

// Встановлюємо фіксований розмір вьюпорта для мобільних пристроїв
if (isTouchDevice) {
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
  }
  
  // Додатковий код для мобільних: підсвічування доступних клітинок
  document.addEventListener('touchmove', function(e) {
    if (dragFrom && e.touches && e.touches[0]) {
      const touch = e.touches[0];
      const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
      
      // Прибираємо виділення з усіх клітинок
      document.querySelectorAll('.square').forEach(sq => {
        if (sq !== touchSelectedSquare) {
          sq.classList.remove('target');
        }
      });
      
      // Якщо навели на клітинку, виділяємо її
      const square = elements.find(el => el.classList.contains('square'));
      if (square && square !== touchSelectedSquare) {
        square.classList.add('target');
      }
    }
  }, { passive: false });
} 