from django.utils import timezone

import requests
from dashboard.models import Activity, Profile
from economy.tx import headers
from economy.utils import convert_token_to_usdt
from grants.models import Contribution, Grant, Subscription

handle = ''
txid = ''
token = ''
to_address = ''
from_address = ''
do_write = False
created_on = timezone.now()
#created_on = timezone.datetime(2020, 6, 15, 8, 0)


profile = Profile.objects.get(handle=handle)

url = f"https://api.aleth.io/v1/transactions/{txid}/contractMessages"
if token and token != '0x0':
    endpoint = 'token-transfers'
    url = f'https://api.aleth.io/v1/{endpoint}?'
    if from_address:
        url += '&filter[from]=' + from_address
    if to_address:
        url += '&filter[to]=' + to_address
    if token:
        url += '&filter[token]=' + token
    url += '&page%5Blimit%5D=100'

transfers = requests.get(
    url,
    headers=headers
).json()
transfers = transfers.get('data', {})

print(f"got {len(transfers)} transfers before txid")

if txid:
    transfers = [xfr for xfr in transfers if txid.lower() in str(xfr).lower()]

print(f"got {len(transfers)} transfers")

for xfr in transfers:
    symbol = xfr['attributes']['symbol'] if token else 'ETH'
    value = xfr['attributes']['value']
    decimals = xfr['attributes']['decimals'] if token else 18
    value_adjusted = int(value) / 10 **int(decimals)
    to = xfr['relationships']['to']['data']['id']
    try:
        grant = Grant.objects.filter(admin_address__iexact=to).order_by('-positive_round_contributor_count').first()
        print(f"{value_adjusted}{symbol}  => {to}, {grant.url} ")
    except:
        print(f"{value_adjusted}{symbol}  => {to}, Unknown Grant ")

    if do_write:

        #ingest data
        currency = symbol
        amount = value_adjusted
        usd_val = amount * convert_token_to_usdt(symbol)

        # convert formats
        try:
            date = timezone.now()

            # create objects
            validator_comment = f"created by ingest grant txn script"
            subscription = Subscription()
            subscription.is_postive_vote = True
            subscription.active = False
            subscription.error = True
            subscription.contributor_address = '/NA'
            subscription.amount_per_period = amount
            subscription.real_period_seconds = 2592000
            subscription.token_address = '0x0'
            subscription.token_symbol = currency
            subscription.gas_price = 0
            subscription.new_approve_tx_id = '0x0'
            subscription.num_tx_approved = 1
            subscription.network = 'mainnet'
            subscription.contributor_profile = profile
            subscription.grant = grant
            subscription.comments = validator_comment
            subscription.amount_per_period_usdt = usd_val
            subscription.save()
            if created_on:
                subscription.created_on = created_on
                subscription.save()

            contrib = Contribution.objects.create(
                success=True,
                tx_cleared=True,
                tx_override=True,
                tx_id=txid,
                subscription=subscription,
                validator_passed=True,
                validator_comment=validator_comment,
                )
            if created_on:
                contrib.created_on = created_on
                contrib.save()
            print(f"ingested {subscription.pk} / {contrib.pk}")

            metadata = {
                'id': subscription.id,
                'value_in_token': str(subscription.amount_per_period),
                'value_in_usdt_now': str(round(subscription.amount_per_period_usdt,2)),
                'token_name': subscription.token_symbol,
                'title': subscription.grant.title,
                'grant_url': subscription.grant.url,
                'num_tx_approved': subscription.num_tx_approved,
                'category': 'grant',
            }
            kwargs = {
                'profile': profile,
                'subscription': subscription,
                'grant': subscription.grant,
                'activity_type': 'new_grant_contribution',
                'metadata': metadata,
            }

            Activity.objects.create(**kwargs)

        except Exception as e:
            print(e)
