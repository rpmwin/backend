import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const port = 8000;

const users = new Map();
const games = new Map();


wss.on("connection", (ws) => {
    console.log("User connected");

    // Auto-register users as 'X' or 'O'
    let userSymbol = "X";

    ws.on("close", () => {
        let disconnectedUserId = null;
        for (let [userId, socket] of users.entries()) {
            if (socket === ws) {
                disconnectedUserId = userId;
                break;
            }
        }

        if (disconnectedUserId) {
            users.delete(disconnectedUserId);
            console.log(`User ${disconnectedUserId} disconnected`);

            for (let [gameId, game] of games.entries()) {
                const playerIndex = game.players.indexOf(disconnectedUserId);
                if (playerIndex !== -1) {
                    game.players.splice(playerIndex, 1);
                    game.players.forEach((player) => {
                        users.get(player).send(
                            JSON.stringify({
                                type: "player_disconnected",
                                message: `Player ${disconnectedUserId} disconnected`,
                            })
                        );
                    });

                    if (game.players.length === 0) {
                        games.delete(gameId);
                    } else {
                        games.set(gameId, game);
                    }
                }
            }
        }
    });

    ws.on("message", (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case "register": {
                if (users.size === 0) {
                    userSymbol = "X"; // First player gets 'X'
                } else if (users.size === 1) {
                    userSymbol = "O"; // Second player gets 'O'
                } else {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Cannot register more than 2 players",
                        })
                    );
                    break;
                }

                const userId = userSymbol;
                users.set(userId, ws);
                ws.send(
                    JSON.stringify({
                        type: "success",
                        message: "User registered",
                        userId: userId,
                    })
                );
                break;
            }

            case "create_game": {
                const userId = getUserSymbol(ws);
                if (!userId) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "User not registered",
                        })
                    );
                    break;
                }

                const gameId = Math.random().toString(36).substring(2, 9);

                const newGame = {
                    id: gameId,
                    players: [userId],
                    board: Array.from({ length: 6 }, () => Array(7).fill(null)),
                    currentPlayer: userId,
                };

                games.set(gameId, newGame);
                ws.send(
                    JSON.stringify({
                        type: "success",
                        message: "Game created",
                        game: newGame,
                    })
                );
                break;
            }

            case "join_game": {
                const userId = getUserSymbol(ws);
                if (!userId) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "User not registered",
                        })
                    );
                    break;
                }

                const gameToJoin = games.get(data.gameId);
                if (!gameToJoin) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Game not found",
                        })
                    );
                    break;
                }

                if (
                    gameToJoin.players.length < 2 &&
                    !gameToJoin.players.includes(userId)
                ) {
                    gameToJoin.players.push(userId);

                    gameToJoin.players.forEach((player) => {
                        users.get(player).send(
                            JSON.stringify({
                                type: "success",
                                message: "Game joined",
                                game: gameToJoin,
                            })
                        );
                    });

                    games.set(data.gameId, gameToJoin);

                    ws.send(
                        JSON.stringify({
                            type: "success",
                            message: "Game joined",
                            game: gameToJoin,
                        })
                    );

                    gameToJoin.players.forEach((player) => {
                        if (player !== userId) {
                            users.get(player).send(
                                JSON.stringify({
                                    type: "current_player",
                                    message:
                                        gameToJoin.currentPlayer === player
                                            ? true
                                            : false,
                                })
                            );
                        }
                    });

                    break;
                }

                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Game is full or you are already in the game",
                    })
                );
                break;
            }

            case "make_move": {
                const userId = getUserSymbol(ws);
                if (!userId) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "User not registered",
                        })
                    );
                    break;
                }

                const game = games.get(data.gameId);
                if (!game) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Game not found",
                        })
                    );
                    break;
                }

                if (game.currentPlayer !== userId) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "It's not your turn",
                        })
                    );
                    break;
                }

                const col = data.col;
                let row = 5; // Start from the bottom row

                while (row >= 0 && game.board[row][col] !== null) {
                    row--;
                }

                if (row < 0) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Column is full",
                        })
                    );
                    break;
                }

                game.board[row][col] = userId;

                const winner = checkWinner(game.board);
                if (winner) {
                    game.players.forEach((player) => {
                        users.get(player).send(
                            JSON.stringify({
                                type: "game_update",
                                game: game,
                            })
                        );
                    });

                    game.players.forEach((player) => {
                        users.get(player).send(
                            JSON.stringify({
                                type: "success",
                                message: "Game over",
                                winner: winner,
                            })
                        );
                    });

                    games.delete(data.gameId);
                    break;
                }

                // Switch the current player
                game.currentPlayer =
                    game.players[
                        (game.players.indexOf(userId) + 1) % game.players.length
                    ];

                game.players.forEach((player) => {
                    users.get(player).send(
                        JSON.stringify({
                            type: "game_update",
                            game: game,
                        })
                    );
                });

                game.players.forEach((player) => {
                    if (player === game.currentPlayer) {
                        users.get(player).send(
                            JSON.stringify({
                                type: "current_player",
                                message: true,
                            })
                        );
                    }
                });

                games.set(data.gameId, game);
                break;
            }

            default:
                console.log("Invalid message type");
                break;
        }
    });
});

server.listen(port, () => {
    console.log(`Server started on port ${port}`);
});

function getUserSymbol(ws) {
    for (let [userId, socket] of users.entries()) {
        if (socket === ws) {
            return userId;
        }
    }
    return null;
}

function checkWinner(board) {
    // Check rows
    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 4; j++) {
            if (
                board[i][j] !== null &&
                board[i][j] === board[i][j + 1] &&
                board[i][j] === board[i][j + 2] &&
                board[i][j] === board[i][j + 3]
            ) {
                return board[i][j];
            }
        }
    }

    // Check columns
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 7; j++) {
            if (
                board[i][j] !== null &&
                board[i][j] === board[i + 1][j] &&
                board[i][j] === board[i + 2][j] &&
                board[i][j] === board[i + 3][j]
            ) {
                return board[i][j];
            }
        }
    }

    // Check diagonals
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) {
            if (
                board[i][j] !== null &&
                board[i][j] === board[i + 1][j + 1] &&
                board[i][j] === board[i + 2][j + 2] &&
                board[i][j] === board[i + 3][j + 3]
            ) {
                return board[i][j];
            }
        }
    }

    for (let i = 3; i < 6; i++) {
        for (let j = 0; j < 4; j++) {
            if (
                board[i][j] !== null &&
                board[i][j] === board[i - 1][j + 1] &&
                board[i][j] === board[i - 2][j + 2] &&
                board[i][j] === board[i - 3][j + 3]
            ) {
                return board[i][j];
            }
        }
    }

    return null;
}
