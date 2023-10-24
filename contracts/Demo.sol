pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DemoCoin is ERC20 {
    bool public state;
    address[] public mods;

    constructor() ERC20("DemoCoin", "DEMO") {
        state = true;
        mods.push(msg.sender);
    }

    modifier onlyMod() {
        require(isMod(msg.sender), "Not a mod");
        _;
    }

    function isMod(address _address) internal view returns (bool) {
        for (uint i = 0; i < mods.length; i++) {
            if (mods[i] == _address) {
                return true;
            }
        }
        return false;
    }

    function addToModList(address _mod) external onlyMod {
        require(!isMod(_mod), "Address is already a mod");
        mods.push(_mod);
    }

    function toggle(bool _state) onlyMod external {
        state = _state;
    }

    function mint() external {
        require(state, 'Not Active');
        _mint(msg.sender, 8);
    }
}