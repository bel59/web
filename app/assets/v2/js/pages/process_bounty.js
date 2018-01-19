window.onload = function(){
    //a little time for web3 injection
    setTimeout(function(){
        var account = web3.eth.accounts[0];

        if(getParam('source')){
            $('input[name=issueURL]').val(getParam('source'));
        }
        if (typeof localStorage['acceptTOS'] !='undefined' && localStorage['acceptTOS']){
            $('input[name=terms]').attr('checked','checked');
        }

        var bountyDetails = []

        $('#goBack').click(function(e) {
            var url = window.location.href;
            var new_url = url.replace('process?source', 'details?url');
            window.location.href = new_url;
        })

        $('#acceptBounty').click(function(e){
            mixpanel.track("Process Bounty Clicked", {});
            e.preventDefault();
            var whatAction = $(this).html().trim()
            var issueURL = $('input[name=issueURL]').val();

            var isError = false;
            if($('#terms:checked').length == 0){
                _alert({ message: "Please accept the terms of service." });
                isError = true;
            } else {
                localStorage['acceptTOS'] = true;
            }
            if(issueURL == ''){
                _alert({ message: "Please enter a issue URL." });
                isError = true;
            }
            if(isError){
                return;
            }

            var bounty = web3.eth.contract(bounty_abi).at(bounty_address());
            loading_button($(this));

            var apiCallback = function(results, status){
                if(status != "success"){
                    mixpanel.track("Process Bounty Error", {step: 'apiCallback', error: error});
                    _alert({ message: "Could not get bounty details" });
                    console.error(error);
                    unloading_button($('.submitBounty'));
                    return;
                } else {
                    results = sanitizeAPIResults(results);
                    result = results[0];

                    var bountyAmount = parseInt(result['value_in_token'], 10); 
                    var fromAddress = result['bounty_owner_address'];
                    var claimeeAddress = result['claimeee_address'];
                    var open = result['is_open'];
                    var initialized = true;
                    var bountyId = result['standard_bounties_id'];

                    var errormsg = undefined;
                    if(bountyAmount == 0 || open == false || initialized == false){
                        errormsg = "No active funding found at this address.  Are you sure this is an active funded issue?";
                    } else if(claimeeAddress == '0x0000000000000000000000000000000000000000'){
                        errormsg = "No claimee found for this bounty.";
                    } else if(fromAddress != web3.eth.coinbase){
                        errormsg = "You can only process a funded issue if you submitted it initially.";
                    }

                    if(errormsg){
                        _alert({ message: errormsg });
                        unloading_button($('.submitBounty'));
                        return;
                    }

                    var final_callback = function(error, result){
                        var next = function(){
                            localStorage['txid'] = result;
                            updates = {
                                is_open: false,  // Close out the bounty in the database
                                idx_status: 'accepted',
                            }
                            sync_web3(issueURL, JSON.stringify(updates));
                            localStorage[issueURL] = timestamp();
                            add_to_watch_list(issueURL);
                            _alert({ message: "Submitted transaction to web3." }, 'info');
                            setTimeout(function(){
                                mixpanel.track("Process Bounty Success", {});
                                document.location.href= "/funding/details?url="+issueURL;
                            },1000);

                        };
                        if(error){
                            mixpanel.track("Process Bounty Error", {step: 'final_callback', error: error});
                            _alert({ message: "There was an error" });
                            console.error(error);
                            unloading_button($('.submitBounty'));
                        } else {
                            next();
                        }
                    };

                    // Standard Bounties can have multiple fulfillments by multiple people.
                    // Gitcoin does not support this yet, it only allows one person to fulfill.
                    // Just in case multilple fulfillments end up on the bounty, we will take 
                    // the latest one, which will match up with what the database has.
                    bounty.getNumFulfillments(bountyId, function (error, result) {
                        var fulfillmentId = result - 1;
                        bounty.acceptFulfillment(bountyId, fulfillmentId, final_callback);
                    });

                    var failure_calllback = function(errors){
                        mixpanel.track("Process Bounty Error", {step: 'estimateGas', error: errors});
                        _alert({ message: "There was an error" });
                        unloading_button($('.submitBounty'));

                    }
                    var success_callback = function(gas, gasLimit){
                        var params = {from :account, 
                                gas:web3.toHex(gas), 
                                gasLimit: web3.toHex(gasLimit), 
                                gasPrice:web3.toHex($("#gasPrice").val() * 10**9), 
                            };
                        method.sendTransaction(issueURL, 
                            params, 
                            _callback);
                    };
                }
            };
            // Get bountyId from the database
            var uri = '/api/v0.1/bounties/?github_url='+issueURL;
            $.get(uri, apiCallback); 
            e.preventDefault();
        });
    },100);

};
