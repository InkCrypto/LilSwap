import React, { useContext } from 'react';
import { Web3Context } from '../context/web3Context.js';
import './NetworkSelector.css';

/**
 * NetworkSelector Component
 * Allows users to select between supported networks (Base, Ethereum, Polygon, BNB)
 */
export const NetworkSelector = () => {
    const { selectedNetwork, setSelectedNetwork, availableNetworks } = useContext(Web3Context);

    const handleNetworkChange = (networkKey) => {
        setSelectedNetwork(networkKey);
    };

    if (!availableNetworks || availableNetworks.length === 0) {
        return null;
    }

    return (
        <div className="network-selector">
            <div className="network-selector__buttons">
                {availableNetworks.map((network) => (
                    <button
                        key={network.key}
                        className={`network-selector__button ${selectedNetwork.key === network.key ? 'network-selector__button--active' : ''
                            }`}
                        onClick={() => handleNetworkChange(network.key)}
                        type="button"
                        title={`Switch to ${network.label}`}
                    >
                        <span className="network-selector__button-label">{network.shortLabel}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};
