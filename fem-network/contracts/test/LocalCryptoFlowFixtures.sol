// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILocalTestToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool);
}

contract LocalTestToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory tokenName, string memory tokenSymbol, uint256 initialSupply) {
        name = tokenName;
        symbol = tokenSymbol;
        totalSupply = initialSupply;
        balanceOf[msg.sender] = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[owner][msg.sender];
        require(permitted >= amount, "allowance exceeded");
        allowance[owner][msg.sender] = permitted - amount;
        _transfer(owner, recipient, amount);
        return true;
    }

    function _transfer(address owner, address recipient, uint256 amount) private {
        require(recipient != address(0), "zero recipient");
        require(balanceOf[owner] >= amount, "balance exceeded");
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(owner, recipient, amount);
    }
}

contract LocalTestWrappedFEM {
    string public constant name = "Wrapped FEM Test Fixture";
    string public constant symbol = "wFEM-test";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        require(msg.value > 0, "zero deposit");
        totalSupply += msg.value;
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0 && balanceOf[msg.sender] >= amount, "invalid withdrawal");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Withdrawal(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "native transfer failed");
    }
}

contract LocalTestConstantProductSwap {
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        require(tokenIn != tokenOut && recipient != address(0), "invalid swap");
        uint256 reserveIn = ILocalTestToken(tokenIn).balanceOf(address(this));
        uint256 reserveOut = ILocalTestToken(tokenOut).balanceOf(address(this));
        require(reserveIn > 0 && reserveOut > 0, "empty pool");
        require(ILocalTestToken(tokenIn).transferFrom(msg.sender, address(this), amountIn), "input transfer failed");
        uint256 amountInWithFee = amountIn * 997;
        amountOut = amountInWithFee * reserveOut / (reserveIn * 1000 + amountInWithFee);
        require(amountOut >= minimumAmountOut && amountOut < reserveOut, "slippage");
        require(ILocalTestToken(tokenOut).transfer(recipient, amountOut), "output transfer failed");
    }
}
