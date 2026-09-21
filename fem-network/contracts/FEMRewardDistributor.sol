// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FEMRewardDistributor {
    uint256 public constant REWARD = 40 ether;
    uint256 public constant MAX_CLAIMS = 500_000;

    address public immutable admin;
    bytes32 public immutable merkleRoot;

    uint256 public claimedCount;
    bool public paused;

    mapping(uint256 => uint256) private claimedBitmap;

    error AlreadyClaimed();
    error InvalidProof();
    error InvalidClaimIndex();
    error InvalidCaller();
    error InsufficientFunds();
    error Unauthorized();
    error Paused();

    event Claimed(uint256 indexed index, address indexed account, uint256 amount);
    event PauseStateChanged(bool paused);

    constructor(address adminAddress, bytes32 root) {
        admin = adminAddress;
        merkleRoot = root;
    }

    receive() external payable {}

    function claim(uint256 index, address account, bytes32[] calldata proof) external {
        if (paused) revert Paused();
        if (msg.sender != account) revert InvalidCaller();
        if (index >= MAX_CLAIMS) revert InvalidClaimIndex();
        if (_isClaimed(index)) revert AlreadyClaimed();
        if (!_isValidProof(index, account, proof)) revert InvalidProof();
        if (address(this).balance < REWARD) revert InsufficientFunds();

        _markClaimed(index);
        claimedCount += 1;

        (bool success, ) = account.call{value: REWARD}("");
        if (!success) revert InsufficientFunds();

        emit Claimed(index, account, REWARD);
    }

    function setPaused(bool pauseState) external {
        if (msg.sender != admin) revert Unauthorized();
        paused = pauseState;
        emit PauseStateChanged(pauseState);
    }

    function isClaimed(uint256 index) external view returns (bool) {
        return _isClaimed(index);
    }

    function _isClaimed(uint256 index) private view returns (bool) {
        uint256 word = claimedBitmap[index / 256];
        uint256 mask = 1 << (index % 256);
        return word & mask != 0;
    }

    function _markClaimed(uint256 index) private {
        claimedBitmap[index / 256] |= 1 << (index % 256);
    }

    function _isValidProof(
        uint256 index,
        address account,
        bytes32[] calldata proof
    ) private view returns (bool) {
        bytes32 computedHash = keccak256(abi.encodePacked(index, account));
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            computedHash = computedHash < proofElement
                ? keccak256(abi.encodePacked(computedHash, proofElement))
                : keccak256(abi.encodePacked(proofElement, computedHash));
        }
        return computedHash == merkleRoot;
    }
}