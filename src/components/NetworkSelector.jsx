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
                {availableNetworks.map((network) => {
                    const isActive = selectedNetwork.key === network.key;
                    return (
                        <button
                            key={network.key}
                            className={`network-selector__button ${isActive ? 'network-selector__button--active' : ''
                                }`}
                            onClick={() => handleNetworkChange(network.key)}
                            type="button"
                            title={isActive ? undefined : network.label}
                        >
                            <div className="network-selector__button-content">
                                {network.icon && (
                                    <img
                                        src={network.icon}
                                        alt={network.shortLabel}
                                        className="network-selector__icon"
                                    />
                                )}
                                {isActive && (
                                    <span className="network-selector__button-label hidden md:inline">
                                        {network.shortLabel}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
